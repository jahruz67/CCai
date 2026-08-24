import { describe, expect, it, vi } from "vitest";
import {
  AssistantBusyError,
  AssistantCooldownError,
  AssistantService,
  QuestionTooLongError,
  needsWebSearch,
  type TextGenerator,
} from "../src/assistant-service.js";
import { ConversationStore } from "../src/conversation-store.js";
import { ConcurrencyLimiter } from "../src/concurrency-limiter.js";
import { Cooldown } from "../src/cooldown.js";
import { KeyedSerialQueue } from "../src/keyed-serial-queue.js";

function createService(
  generator: TextGenerator,
  options: {
    cooldownMs?: number;
    maxConcurrentRequests?: number;
    maxQuestionCharacters?: number;
  } = {},
): AssistantService {
  return new AssistantService(
    generator,
    new ConversationStore({
      maxContextChars: 10_000,
      maxTurns: 3,
      ttlMs: 60_000,
    }),
    new Cooldown(options.cooldownMs ?? 0),
    new KeyedSerialQueue(),
    new ConcurrencyLimiter(options.maxConcurrentRequests ?? 4),
    options.maxQuestionCharacters ?? 100,
  );
}

describe("needsWebSearch", () => {
  it("returns true for current-event questions", () => {
    expect(needsWebSearch("what is the latest news today?")).toBe(true);
    expect(needsWebSearch("who won the game last week?")).toBe(true);
    expect(needsWebSearch("what's the current price of bitcoin?")).toBe(true);
    expect(needsWebSearch("what happened with the election 2026?")).toBe(true);
    expect(needsWebSearch("any recent updates on AI?")).toBe(true);
    expect(needsWebSearch("search for space telescope discoveries")).toBe(true);
    expect(needsWebSearch("what are the trending topics right now?")).toBe(true);
  });

  it("returns false for timeless/factual questions", () => {
    expect(needsWebSearch("what is 2 + 2?")).toBe(false);
    expect(needsWebSearch("explain how recursion works")).toBe(false);
    expect(needsWebSearch("what is the speed of light?")).toBe(false);
    expect(needsWebSearch("write me a python hello world program")).toBe(false);
  });
});

describe("AssistantService", () => {
  it("includes successful prior turns in a follow-up", async () => {
    const generate = vi
      .fn<TextGenerator["generate"]>()
      .mockResolvedValueOnce("2")
      .mockResolvedValueOnce("Because 1 + 1 = 2.");
    const service = createService({ generate });

    await service.answer("scope", "user", "one plus one");
    await service.answer("scope", "user", "explain why");

    expect(generate.mock.calls[1]?.[0]).toEqual([
      { content: "one plus one", role: "user" },
      { content: "2", role: "assistant" },
      { content: "explain why", role: "user" },
    ]);
  });

  it("does not save a failed turn", async () => {
    const generate = vi
      .fn<TextGenerator["generate"]>()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce("works");
    const service = createService({ generate });

    await expect(service.answer("scope", "user", "bad")).rejects.toThrow();
    await service.answer("scope", "user", "good");
    expect(generate.mock.calls[1]?.[0]).toEqual([
      { content: "good", role: "user" },
    ]);
  });

  it("handles image inputs and constructs multimodal messages", async () => {
    const generate = vi.fn<TextGenerator["generate"]>().mockResolvedValueOnce("A red bird.");
    const service = createService({ generate });

    const answer = await service.answer(
      "scope",
      "user",
      "What bird is this?",
      ["data:image/png;base64,123"],
    );

    expect(answer).toBe("A red bird.");
    expect(generate).toHaveBeenCalledWith(
      [
        {
          content: [
            { text: "What bird is this?", type: "text" },
            { image_url: { url: "data:image/png;base64,123" }, type: "image_url" },
          ],
          role: "user",
        },
      ],
      undefined,
    );
  });

  it("defaults question to 'Describe this image.' when question is empty and image is provided", async () => {
    const generate = vi.fn<TextGenerator["generate"]>().mockResolvedValueOnce("A sunrise.");
    const service = createService({ generate });

    await service.answer("scope", "user", "", ["data:image/png;base64,123"]);

    expect(generate).toHaveBeenCalledWith(
      [
        {
          content: [
            { text: "Describe this image.", type: "text" },
            { image_url: { url: "data:image/png;base64,123" }, type: "image_url" },
          ],
          role: "user",
        },
      ],
      undefined,
    );
  });


  it("enforces question length and cooldown", async () => {
    const generate = vi.fn<TextGenerator["generate"]>().mockResolvedValue("ok");
    const service = createService(
      { generate },
      { cooldownMs: 10_000, maxQuestionCharacters: 4 },
    );

    await expect(service.answer("scope", "user", "12345")).rejects.toBeInstanceOf(
      QuestionTooLongError,
    );
    await service.answer("scope", "user", "1234");
    await expect(service.answer("other", "user", "1234")).rejects.toBeInstanceOf(
      AssistantCooldownError,
    );
  });

  it("rejects overlapping requests in the same scope", async () => {
    const seen: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const generator: TextGenerator = {
      async generate(messages) {
        const current = messages.at(-1)?.content ?? "";
        seen.push(`start:${current}`);
        if (current === "first") {
          markFirstStarted();
          await firstGate;
        }
        seen.push(`end:${current}`);
        return `answer:${current}`;
      },
    };
    const service = createService(generator);

    const first = service.answer("scope", "user-a", "first");
    await firstStarted;
    expect(seen).toEqual(["start:first"]);
    await expect(
      service.answer("scope", "user-b", "second"),
    ).rejects.toBeInstanceOf(AssistantBusyError);
    releaseFirst();
    await first;
    expect(seen).toEqual(["start:first", "end:first"]);
  });

  it("does not restore context when clear runs during generation", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const generate = vi
      .fn<TextGenerator["generate"]>()
      .mockImplementationOnce(async () => {
        markStarted();
        await gate;
        return "old answer";
      })
      .mockResolvedValueOnce("new answer");
    const service = createService({ generate });

    const pending = service.answer("scope", "user", "old question");
    await started;
    service.clear("scope");
    release();
    await pending;
    await service.answer("scope", "user", "new question");

    expect(generate.mock.calls[1]?.[0]).toEqual([
      { content: "new question", role: "user" },
    ]);
  });

  it("caps provider concurrency across different scopes", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const generator: TextGenerator = {
      async generate() {
        markStarted();
        await gate;
        return "answer";
      },
    };
    const service = createService(generator, { maxConcurrentRequests: 1 });

    const first = service.answer("scope-a", "user-a", "first");
    await started;
    await expect(
      service.answer("scope-b", "user-b", "second"),
    ).rejects.toMatchObject({ name: "AssistantBusyError", scope: "global" });
    release();
    await first;
  });

  it("injects saved memories and abbreviations into question prompt context", async () => {
    const generate = vi.fn<TextGenerator["generate"]>().mockResolvedValue("BRB means Be Right Back.");
    const memoryStore = {
      formatForPrompt: vi.fn().mockReturnValue("[Saved Memories & Abbreviations]\n- BRB: Be Right Back"),
      getMemoriesForContext: vi.fn().mockResolvedValue([
        { key: "BRB", scope: "user:123", value: "Be Right Back" },
      ]),
      isEnabled: vi.fn().mockReturnValue(true),
    };

    const service = new AssistantService(
      { generate },
      new ConversationStore({ maxContextChars: 10_000, maxTurns: 3, ttlMs: 60_000 }),
      new Cooldown(0),
      new KeyedSerialQueue(),
      new ConcurrencyLimiter(4),
      1000,
      undefined,
      memoryStore as any,
    );

    const answer = await service.answer(
      "scope",
      "user-123",
      "what does BRB mean?",
      undefined,
      undefined,
      "guild-456",
    );

    expect(answer).toBe("BRB means Be Right Back.");
    expect(memoryStore.getMemoriesForContext).toHaveBeenCalledWith("user:user-123", "guild:guild-456");
    expect(generate).toHaveBeenCalledWith(
      [
        {
          content: "[Saved Memories & Abbreviations]\n- BRB: Be Right Back\n\n[User question]\nwhat does BRB mean?",
          role: "user",
        },
      ],
      undefined,
    );
  });
});
