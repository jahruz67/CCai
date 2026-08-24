import "dotenv/config";
import v8 from "node:v8";
import vm from "node:vm";
import { AiClient } from "./ai-client.js";
import { AssistantService } from "./assistant-service.js";
import { createDiscordClient } from "./bot.js";
import { loadConfig } from "./config.js";
import { ConversationStore } from "./conversation-store.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { Cooldown } from "./cooldown.js";
import { KeyedSerialQueue } from "./keyed-serial-queue.js";
import { MemoryStore } from "./memory-store.js";
import { SearchService } from "./search-provider.js";

// Tune V8 engine for minimum memory footprint
try {
  v8.setFlagsFromString("--optimize_for_size");
  v8.setFlagsFromString("--max_old_space_size=40");
  v8.setFlagsFromString("--max_semi_space_size=1");
  v8.setFlagsFromString("--expose_gc");
} catch {}

function forceGC(): void {
  try {
    if (typeof global.gc === "function") {
      global.gc();
    } else {
      const gc = vm.runInNewContext("gc");
      if (typeof gc === "function") {
        gc();
      }
    }
  } catch {}
}

async function main(): Promise<void> {
  const config = loadConfig();
  const searchService = new SearchService(config.search);
  const conversations = new ConversationStore({
    enabled: config.history.enabled,
    maxChars: config.history.maxChars,
    ttlMs: config.history.ttlMs,
  });
  const cooldown = new Cooldown(config.cooldownMs);
  const memoryStore = new MemoryStore({
    databaseUrl: config.memory.databaseUrl,
    enabled: config.memory.enabled,
    maxKeyChars: config.memory.maxKeyChars,
    maxPerScope: config.memory.maxPerScope,
    maxValueChars: config.memory.maxValueChars,
  });

  if (memoryStore.isEnabled()) {
    try {
      await memoryStore.init();
      console.log("PostgreSQL MemoryStore initialized successfully.");
    } catch (error) {
      console.error(
        "Failed to connect to PostgreSQL MemoryStore, running with memory disabled.",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const aiClient = new AiClient(config.ai, fetch, searchService);
  const assistant = new AssistantService(
    aiClient,
    conversations,
    cooldown,
    new KeyedSerialQueue(),
    new ConcurrencyLimiter(config.maxConcurrentRequests),
    config.maxQuestionChars,
    searchService,
    memoryStore,
  );
  const client = createDiscordClient(config, assistant, memoryStore);

  const sweepInterval = setInterval(() => {
    conversations.sweep();
    cooldown.sweep();
    forceGC();
  }, 60_000);
  sweepInterval.unref?.();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    clearInterval(sweepInterval);
    await memoryStore.close().catch(() => undefined);
    client.destroy();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await client.login(config.discord.token);
  // Free initial bootstrap & handshake allocations from memory immediately
  forceGC();
}

main().catch((error: unknown) => {
  console.error("CC failed to start", {
    errorType: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message.slice(0, 500) : undefined,
  });
  process.exitCode = 1;
});
