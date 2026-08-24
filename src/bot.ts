import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Options,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import {
  AiNetworkError,
  AiIncompleteResponseError,
  AiProviderError,
  AiRefusalError,
  AiTimeoutError,
} from "./ai-client.js";
import {
  AssistantBusyError,
  AssistantCooldownError,
  AssistantService,
  QuestionTooLongError,
} from "./assistant-service.js";
import {
  helpText,
  parseBuiltInCommand,
  parseForgetCommand,
  parseRememberCommand,
  parseSearchCommand,
} from "./commands.js";
import type { BotConfig } from "./config.js";
import type { MemoryEntry, MemoryStore } from "./memory-store.js";
import {
  conversationKey,
  extractImagesFromInteraction,
  extractImagesFromMessage,
  splitDiscordMessage,
  suppressUrlEmbeds,
} from "./message-utils.js";
import { parsePrompt } from "./prompt-parser.js";
import {
  parseManageCommand,
  ServerManager,
  type ManageCommand,
} from "./server-management.js";

const SAFE_MENTIONS = { parse: [] as never[], repliedUser: false };
const MEMORY_DISABLED_MSG =
  "⚠️ Memory is currently disabled. To enable persistent abbreviations and memory, set `DATABASE_URL` in your `.env` to a PostgreSQL database (e.g. Aiven PostgreSQL).";

export function createDiscordClient(
  config: BotConfig,
  assistant: AssistantService,
  memoryStore?: MemoryStore,
): Client {
  const serverManager = new ServerManager(
    assistant,
    config.adminRoles.ids,
    config.adminRoles.names,
  );
  const client = new Client({
    allowedMentions: SAFE_MENTIONS,
    intents: [
      GatewayIntentBits.Guilds,
      ...(config.discord.membersIntentEnabled
        ? [GatewayIntentBits.GuildMembers]
        : []),
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    makeCache: Options.cacheWithLimits({
      ApplicationCommandManager: 0,
      BaseGuildEmojiManager: 0,
      GuildBanManager: 0,
      GuildEmojiManager: 0,
      GuildInviteManager: 0,
      GuildMemberManager: 0,
      GuildScheduledEventManager: 0,
      GuildStickerManager: 0,
      MessageManager: 0,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      StageInstanceManager: 0,
      ThreadManager: 0,
      ThreadMemberManager: 0,
      UserManager: 0,
      VoiceStateManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 300,
        lifetime: 60,
      },
    },
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(
      `CC is online as ${readyClient.user.tag}. Prefix: ${config.prefix}`,
    );
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(client, config, assistant, serverManager, memoryStore, message).catch((error) => {
      logRuntimeError("message handler", error);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    void handleInteraction(config, assistant, serverManager, memoryStore, interaction).catch((error) => {
      logRuntimeError("interaction handler", error);
    });
  });

  client.on(Events.Error, (error) => {
    logRuntimeError("Discord client", error);
  });

  return client;
}

async function handleMessage(
  client: Client,
  config: BotConfig,
  assistant: AssistantService,
  serverManager: ServerManager,
  memoryStore: MemoryStore | undefined,
  message: Message,
): Promise<void> {
  if (!client.user || message.author.bot || message.webhookId) {
    return;
  }

  if (
    !isAllowedChannel(
      config,
      message.channelId,
      message.guildId,
      message.channel.isThread() ? message.channel.parentId : null,
    )
  ) {
    return;
  }

  let parsed = parsePrompt({
    botUserId: client.user.id,
    content: message.content,
    hasAttachments: message.attachments.size > 0,
    isDirectMessage: message.guildId === null,
    isReplyToBot: false,
    prefix: config.prefix,
  });
  if (!parsed && message.reference?.messageId) {
    const replyToBot = await isReplyToBot(message, client.user.id);
    if (replyToBot) {
      parsed = parsePrompt({
        botUserId: client.user.id,
        content: message.content,
        hasAttachments: message.attachments.size > 0,
        isDirectMessage: message.guildId === null,
        isReplyToBot: true,
        prefix: config.prefix,
      });
    }
  }
  if (!parsed) {
    return;
  }

  const scopeKey = conversationKey(
    message.guildId,
    message.channelId,
    message.author.id,
  );

  const imageUrls = await extractImagesFromMessage(message);

  if (!parsed.text) {
    if (imageUrls.length > 0) {
      parsed.text = "Describe this image.";
    } else {
      await safeMessageReply(message, helpText(config.prefix));
      return;
    }
  }

  const manageCommand = parseManageCommand(parsed.text);
  if (manageCommand) {
    if (!message.guild) {
      await safeMessageReply(message, "Server management is only available inside a server.");
      return;
    }
    const stopTyping = startTyping(message);
    try {
      const member = message.member ?? await message.guild.members.fetch(message.author.id);
      const result = await serverManager.handle(
        manageCommand,
        message.guild,
        member,
        message.channelId,
      );
      await sendMessageChunks(message, result);
    } catch (error) {
      logAssistantError(error);
      await safeMessageReply(message, managementFacingError(error));
    } finally {
      stopTyping();
    }
    return;
  }

  // Check for search command
  const searchQuery = parseSearchCommand(parsed.text);
  if (searchQuery !== undefined) {
    if (!searchQuery) {
      await safeMessageReply(
        message,
        `Please specify what you would like to search for, e.g. \`${config.prefix} search latest space missions\`.`,
      );
      return;
    }

    const stopTyping = startTyping(message);
    let answer: string;
    try {
      answer = await assistant.search(
        scopeKey,
        message.author.id,
        searchQuery,
        undefined,
        message.guildId ?? undefined,
      );
    } catch (error) {
      logAssistantError(error);
      await safeMessageReply(message, userFacingError(error));
      return;
    } finally {
      stopTyping();
    }

    try {
      await sendMessageChunks(message, answer);
    } catch (error) {
      logRuntimeError("Discord search answer delivery", error);
    }
    return;
  }

  // Check for remember command
  const rememberCmd = parseRememberCommand(parsed.text);
  if (rememberCmd) {
    if (!memoryStore || !memoryStore.isEnabled()) {
      await safeMessageReply(message, MEMORY_DISABLED_MSG);
      return;
    }

    const isServer = rememberCmd.isServerScope && Boolean(message.guildId);
    const scope = isServer ? `guild:${message.guildId}` : `user:${message.author.id}`;
    const scopeLabel = isServer ? "Server" : "Personal";

    try {
      const res = await memoryStore.remember(
        scope,
        rememberCmd.key,
        rememberCmd.value,
        message.author.id,
      );
      const actionVerb = res.created ? "Remembered" : "Updated";
      await safeMessageReply(
        message,
        `🧠 ${actionVerb}: **${res.entry.key}** = *${res.entry.value}* (${scopeLabel})`,
      );
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Failed to save memory.";
      await safeMessageReply(message, `⚠️ ${errText}`);
    }
    return;
  }

  // Check for forget command
  const forgetCmd = parseForgetCommand(parsed.text);
  if (forgetCmd) {
    if (!memoryStore || !memoryStore.isEnabled()) {
      await safeMessageReply(message, MEMORY_DISABLED_MSG);
      return;
    }

    const isServer = forgetCmd.isServerScope && Boolean(message.guildId);
    const scope = isServer ? `guild:${message.guildId}` : `user:${message.author.id}`;
    const scopeLabel = isServer ? "server" : "personal";

    try {
      if (forgetCmd.isAll) {
        const count = await memoryStore.forgetAll(scope);
        await safeMessageReply(
          message,
          `🗑️ Cleared all ${count} ${scopeLabel} memories.`,
        );
      } else {
        const deleted = await memoryStore.forget(scope, forgetCmd.key);
        if (deleted) {
          await safeMessageReply(
            message,
            `🗑️ Forgot memory for **${forgetCmd.key}** (${scopeLabel}).`,
          );
        } else {
          await safeMessageReply(
            message,
            `❓ No ${scopeLabel} memory found matching **${forgetCmd.key}**.`,
          );
        }
      }
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Failed to forget memory.";
      await safeMessageReply(message, `⚠️ ${errText}`);
    }
    return;
  }

  // "cc memory" alone or list-variants → show memory list
  // "cc memory <any text>" → let AI extract key/value and save it
  const memoryText = parsed.text.trim();
  const isMemoryPrefix =
    /^(?:memory|mem)(?:\s|$)/i.test(memoryText) || /^memories$/i.test(memoryText);

  if (isMemoryPrefix) {
    if (!memoryStore || !memoryStore.isEnabled()) {
      await safeMessageReply(message, MEMORY_DISABLED_MSG);
      return;
    }

    // Everything after "memory " or "mem "
    const afterMemory = memoryText.replace(/^(?:memory|mem)\s*/i, "").trim();

    // Determine server scope from leading tag
    let contentToExtract = afterMemory;
    let isServerScope = false;
    const serverTag = afterMemory.match(/^(?:\[server\]|server:?)\s+(.+)$/i);
    if (serverTag && serverTag[1]) {
      isServerScope = true;
      contentToExtract = serverTag[1].trim();
    }

    // If nothing after "memory" (or just a scope filter keyword) → show list
    const listKeywords = ["", "list", "server", "personal", "all", "my", "show", "saved",
      "server memories", "personal memories", "my memories", "list memories",
      "list server memories", "show memories", "saved memories", "my memory"];
    if (listKeywords.includes(contentToExtract.toLowerCase())) {
      const scope =
        /^(?:server|server memories|list server memories)$/i.test(contentToExtract)
          ? "server"
          : /^(?:personal|personal memories|my memory|my memories)$/i.test(contentToExtract)
            ? "personal"
            : "all";
      try {
        const formattedList = await formatMemoryListResponse(
          memoryStore,
          message.author.id,
          message.guildId,
          scope,
        );
        await safeMessageReply(message, formattedList);
      } catch (error) {
        const errText = error instanceof Error ? error.message : "Failed to retrieve memories.";
        await safeMessageReply(message, `⚠️ ${errText}`);
      }
      return;
    }

    // There's content → ask the AI to extract key/value from natural language
    const stopTyping = startTyping(message);
    let extracted: { key: string; value: string } | undefined;
    try {
      extracted = await assistant.extractMemoryKeyValue(contentToExtract);
    } finally {
      stopTyping();
    }

    if (!extracted) {
      await safeMessageReply(
        message,
        `❓ I couldn't figure out what to save from that. Try:\n\`${config.prefix} remember <key> = <value>\`\nFor example: \`${config.prefix} remember cpp = cal poly pomona\``,
      );
      return;
    }

    const isServer = isServerScope && Boolean(message.guildId);
    const scope = isServer ? `guild:${message.guildId}` : `user:${message.author.id}`;
    const scopeLabel = isServer ? "Server" : "Personal";

    try {
      const res = await memoryStore.remember(scope, extracted.key, extracted.value, message.author.id);
      const actionVerb = res.created ? "Remembered" : "Updated";
      await safeMessageReply(
        message,
        `🧠 ${actionVerb}: **${res.entry.key}** = *${res.entry.value}* (${scopeLabel})`,
      );
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Failed to save memory.";
      await safeMessageReply(message, `⚠️ ${errText}`);
    }
    return;
  }


  // Built-in commands
  const command = parseBuiltInCommand(parsed.text);
  if (command === "help") {
    await safeMessageReply(message, helpText(config.prefix));
    return;
  }
  if (command === "clear") {
    assistant.clear(scopeKey);
    await safeMessageReply(message, "Your recent context in this channel is cleared.");
    return;
  }
  if (command === "ping") {
    await safeMessageReply(message, "Pong! 🏓");
    return;
  }

  const stopTyping = startTyping(message);
  let answer: string;
  try {
    answer = await assistant.answer(
      scopeKey,
      message.author.id,
      parsed.text,
      imageUrls,
      undefined,
      message.guildId ?? undefined,
    );
  } catch (error) {
    logAssistantError(error);
    await safeMessageReply(message, userFacingError(error));
    return;
  } finally {
    stopTyping();
  }

  try {
    await sendMessageChunks(message, answer);
  } catch (error) {
    logRuntimeError("Discord answer delivery", error);
  }
}

async function handleInteraction(
  config: BotConfig,
  assistant: AssistantService,
  serverManager: ServerManager,
  memoryStore: MemoryStore | undefined,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !isAllowedChannel(
      config,
      interaction.channelId,
      interaction.guildId,
      interaction.channel?.isThread() ? interaction.channel.parentId : null,
    )
  ) {
    await interaction.reply({
      content: "CC is not enabled in this channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scopeKey = conversationKey(
    interaction.guildId,
    interaction.channelId,
    interaction.user.id,
  );

  if (interaction.commandName === "help") {
    await interaction.reply({
      content: helpText(config.prefix),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "clear") {
    assistant.clear(scopeKey);
    await interaction.reply({
      content: "Your recent context in this channel is cleared.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "ping") {
    await interaction.reply({ content: "Pong! 🏓", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "manage") {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Server management is only available inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand(true);
    const command: ManageCommand =
      subcommand === "confirm"
        ? { kind: "confirm" }
        : subcommand === "cancel"
          ? { kind: "cancel" }
          : {
              kind: "request",
              request: interaction.options.getString("instruction", true),
            };
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const result = await serverManager.handle(
        command,
        interaction.guild,
        member,
        interaction.channelId,
      );
      const chunks = splitDiscordMessage(result);
      await interaction.editReply({
        allowedMentions: SAFE_MENTIONS,
        content: chunks.shift() ?? "The management request produced no result.",
      });
      for (const chunk of chunks) {
        await interaction.followUp({
          allowedMentions: SAFE_MENTIONS,
          content: chunk,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logAssistantError(error);
      await interaction.editReply({
        allowedMentions: SAFE_MENTIONS,
        content: managementFacingError(error),
      });
    }
    return;
  }

  // Handle /remember
  if (interaction.commandName === "remember") {
    if (!memoryStore || !memoryStore.isEnabled()) {
      await interaction.reply({
        content: MEMORY_DISABLED_MSG,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString("key", true);
    const value = interaction.options.getString("value", true);
    const scopeOption = interaction.options.getString("scope") ?? "personal";

    const isServer = scopeOption === "server" && Boolean(interaction.guildId);
    const scope = isServer ? `guild:${interaction.guildId}` : `user:${interaction.user.id}`;
    const scopeLabel = isServer ? "Server" : "Personal";

    try {
      const res = await memoryStore.remember(scope, key, value, interaction.user.id);
      const actionVerb = res.created ? "Remembered" : "Updated";
      await interaction.reply({
        content: `🧠 ${actionVerb}: **${res.entry.key}** = *${res.entry.value}* (${scopeLabel})`,
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Failed to save memory.";
      await interaction.reply({
        content: `⚠️ ${errText}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  // Handle /forget
  if (interaction.commandName === "forget") {
    if (!memoryStore || !memoryStore.isEnabled()) {
      await interaction.reply({
        content: MEMORY_DISABLED_MSG,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString("key", true);
    const scopeOption = interaction.options.getString("scope") ?? "personal";

    const isServer = scopeOption === "server" && Boolean(interaction.guildId);
    const scope = isServer ? `guild:${interaction.guildId}` : `user:${interaction.user.id}`;
    const scopeLabel = isServer ? "server" : "personal";
    const isAll = key.toLowerCase() === "all" || key.toLowerCase() === "everything";

    try {
      if (isAll) {
        const count = await memoryStore.forgetAll(scope);
        await interaction.reply({
          content: `🗑️ Cleared all ${count} ${scopeLabel} memories.`,
        });
      } else {
        const deleted = await memoryStore.forget(scope, key);
        if (deleted) {
          await interaction.reply({
            content: `🗑️ Forgot memory for **${key}** (${scopeLabel}).`,
          });
        } else {
          await interaction.reply({
            content: `❓ No ${scopeLabel} memory found matching **${key}**.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Failed to forget memory.";
      await interaction.reply({
        content: `⚠️ ${errText}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  // Handle /memory
  if (interaction.commandName === "memory") {
    if (!memoryStore || !memoryStore.isEnabled()) {
      await interaction.reply({
        content: MEMORY_DISABLED_MSG,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const scopeOption =
      (interaction.options.getString("scope") as "all" | "personal" | "server" | null) ??
      "all";

    try {
      const formattedList = await formatMemoryListResponse(
        memoryStore,
        interaction.user.id,
        interaction.guildId,
        scopeOption,
      );
      await interaction.reply({
        content: formattedList,
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : "Failed to retrieve memories.";
      await interaction.reply({
        content: `⚠️ ${errText}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  // Handle /search
  if (interaction.commandName === "search") {
    await interaction.deferReply();
    const query = interaction.options.getString("query", true);

    let answer: string;
    try {
      answer = await assistant.search(
        scopeKey,
        interaction.user.id,
        query,
        undefined,
        interaction.guildId ?? undefined,
      );
    } catch (error) {
      logAssistantError(error);
      await interaction.editReply({
        content: userFacingError(error),
        allowedMentions: SAFE_MENTIONS,
      });
      return;
    }

    try {
      const chunks = splitDiscordMessage(suppressUrlEmbeds(answer));
      const firstChunk = chunks.shift() ?? "I could not generate a search response.";
      await interaction.editReply({
        allowedMentions: SAFE_MENTIONS,
        content: firstChunk,
        flags: MessageFlags.SuppressEmbeds,
      });
      for (const chunk of chunks) {
        await interaction.followUp({
          allowedMentions: SAFE_MENTIONS,
          content: chunk,
          flags: MessageFlags.SuppressEmbeds,
        });
      }
    } catch (error) {
      logRuntimeError("Discord search interaction delivery", error);
    }
    return;
  }

  if (interaction.commandName !== "ask") {
    return;
  }

  await interaction.deferReply();
  const question = interaction.options.getString("question", true);
  const imageUrls = await extractImagesFromInteraction(interaction);

  let answer: string;
  try {
    answer = await assistant.answer(
      scopeKey,
      interaction.user.id,
      question,
      imageUrls,
      undefined,
      interaction.guildId ?? undefined,
    );
  } catch (error) {
    logAssistantError(error);
    await interaction.editReply({
      allowedMentions: SAFE_MENTIONS,
      content: userFacingError(error),
    });
    return;
  }

  try {
    const chunks = splitDiscordMessage(suppressUrlEmbeds(answer));
    const firstChunk = chunks.shift() ?? "I could not generate a response.";
    await interaction.editReply({
      allowedMentions: SAFE_MENTIONS,
      content: firstChunk,
      flags: MessageFlags.SuppressEmbeds,
    });
    for (const chunk of chunks) {
      await interaction.followUp({
        allowedMentions: SAFE_MENTIONS,
        content: chunk,
        flags: MessageFlags.SuppressEmbeds,
      });
    }
  } catch (error) {
    logRuntimeError("Discord interaction delivery", error);
  }
}

async function formatMemoryListResponse(
  memoryStore: MemoryStore,
  userId: string,
  guildId: string | null,
  scopeFilter: "all" | "personal" | "server",
): Promise<string> {
  const userScope = `user:${userId}`;
  const guildScope = guildId ? `guild:${guildId}` : undefined;

  let personalMemories: MemoryEntry[] = [];
  let serverMemories: MemoryEntry[] = [];

  if (scopeFilter === "all" || scopeFilter === "personal") {
    personalMemories = await memoryStore.list(userScope);
  }
  if (guildScope && (scopeFilter === "all" || scopeFilter === "server")) {
    serverMemories = await memoryStore.list(guildScope);
  }

  if (personalMemories.length === 0 && serverMemories.length === 0) {
    return "🧠 You have no saved memories or abbreviations yet. Add one with `cc remember <key> = <value>` or `/remember`!";
  }

  const sections: string[] = ["**🧠 Saved Memories & Abbreviations**"];

  if (personalMemories.length > 0) {
    sections.push("**Personal (Only You):**");
    for (const mem of personalMemories) {
      sections.push(`• **${mem.key}**: ${mem.value}`);
    }
  }

  if (serverMemories.length > 0) {
    if (personalMemories.length > 0) sections.push("");
    sections.push("**Server (Everyone here):**");
    for (const mem of serverMemories) {
      sections.push(`• **${mem.key}**: ${mem.value}`);
    }
  }

  return sections.join("\n");
}

function isAllowedChannel(
  config: BotConfig,
  channelId: string,
  guildId: string | null,
  parentChannelId: string | null,
): boolean {
  if (guildId === null) {
    return true;
  }

  return (
    config.allowedChannelIds.size === 0 ||
    config.allowedChannelIds.has(channelId) ||
    (parentChannelId !== null && config.allowedChannelIds.has(parentChannelId))
  );
}

async function isReplyToBot(message: Message, botUserId: string): Promise<boolean> {
  if (!message.reference?.messageId) {
    return false;
  }

  try {
    const referencedMessage = await message.fetchReference();
    return referencedMessage.author.id === botUserId;
  } catch {
    return false;
  }
}

function startTyping(message: Message): () => void {
  if (!("sendTyping" in message.channel)) {
    return () => undefined;
  }

  const channel = message.channel;
  const sendTyping = () => {
    void channel.sendTyping().catch(() => undefined);
  };
  sendTyping();
  const interval = setInterval(sendTyping, 8_000);
  interval.unref?.();
  return () => clearInterval(interval);
}

async function sendMessageChunks(message: Message, content: string): Promise<void> {
  const chunks = splitDiscordMessage(suppressUrlEmbeds(content));
  const firstChunk = chunks.shift() ?? "I could not generate a response.";
  await message.reply({
    allowedMentions: SAFE_MENTIONS,
    content: firstChunk,
    flags: MessageFlags.SuppressEmbeds,
  });

  if (!("send" in message.channel)) {
    return;
  }

  for (const chunk of chunks) {
    await message.channel.send({
      allowedMentions: SAFE_MENTIONS,
      content: chunk,
      flags: MessageFlags.SuppressEmbeds,
    });
  }
}

async function safeMessageReply(message: Message, content: string): Promise<void> {
  try {
    await message.reply({
      allowedMentions: SAFE_MENTIONS,
      content: suppressUrlEmbeds(content),
      flags: MessageFlags.SuppressEmbeds,
    });
  } catch (error) {
    logRuntimeError("Discord reply", error);
  }
}

function userFacingError(error: unknown): string {
  if (error instanceof AssistantCooldownError) {
    const seconds = Math.max(1, Math.ceil(error.remainingMs / 1_000));
    return `Slow down a little—try again in ${seconds}s.`;
  }
  if (error instanceof QuestionTooLongError) {
    return `That question is too long. Keep it under ${error.maxCharacters.toLocaleString()} characters.`;
  }
  if (error instanceof AssistantBusyError) {
    return error.scope === "conversation"
      ? "I’m still answering your previous question in this channel."
      : "I’m handling several questions right now. Please try again shortly.";
  }
  if (error instanceof AiTimeoutError) {
    return "The AI took too long to answer. Please try again.";
  }
  if (error instanceof AiNetworkError) {
    return "I cannot reach the AI service right now. Please try again shortly.";
  }
  if (error instanceof AiRefusalError) {
    return "I can’t help with that request.";
  }
  if (error instanceof AiIncompleteResponseError) {
    return "I couldn’t finish that answer. Try a shorter or simpler question.";
  }
  if (error instanceof AiProviderError) {
    if (error.status === 401 || error.status === 403) {
      return "The AI service is not configured correctly. Please tell the server owner.";
    }
    if (error.status === 429) {
      return "The AI service is busy or rate-limited. Please try again shortly.";
    }
    if (error.status >= 500) {
      return "The AI service is having trouble right now. Please try again shortly.";
    }
  }
  return "Something went wrong while answering. Please try again.";
}

function managementFacingError(error: unknown): string {
  if (
    error instanceof AiTimeoutError ||
    error instanceof AiNetworkError ||
    error instanceof AiRefusalError ||
    error instanceof AiIncompleteResponseError ||
    error instanceof AiProviderError
  ) {
    return userFacingError(error);
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return `I could not prepare that management request: ${message.slice(0, 500)}`;
}

function logAssistantError(error: unknown): void {
  if (error instanceof AiProviderError) {
    console.error("AI provider error", {
      requestId: error.requestId,
      status: error.status,
    });
    return;
  }
  console.error("Assistant request failed", {
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

function logRuntimeError(area: string, error: unknown): void {
  console.error(`${area} failed`, {
    errorType: error instanceof Error ? error.name : typeof error,
  });
}
