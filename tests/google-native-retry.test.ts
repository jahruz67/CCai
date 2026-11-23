import { describe, expect, it, vi } from "vitest";
import { GoogleNativeProvider } from "../src/providers/google-native-provider.js";
import { AiClient } from "../src/ai-client.js";
import { FallbackOrchestrator } from "../src/fallback-orchestrator.js";
import { AiTimeoutError } from "../src/ai-errors.js";
import type { BotConfig, AiFallbackConfig } from "../src/config.js";
import type { FetchLike } from "../src/providers/types.js";
import type { ChatMessage } from "../src/types.js";

function googleConfig(overrides: Partial<BotConfig["ai"]> = {}): BotConfig["ai"] {
  return {
    apiKey: "test-google-key-12345",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    chatTokenField: "auto",
    fallback: undefined,
    maxOutputTokens: 500,
    model: "gemma-4-31b-it",
    reasoningEffort: "off",
    retry: {
      enabled: true,
      initialDelayMs: 10, // low delay for fast tests
      maxAttempts: 3,
      maxDelayMs: 40,
      requestTimeoutMs: 1_000,
    },
    style: "google-native",
    systemPrompt: "You are CC, an expert Discord assistant.",
    timeoutMs: 5_000,
    webSearchEnabled: false,
    ...overrides,
  };
}

const SAMPLE_MESSAGES: ChatMessage[] = [
  { content: "What is quantum entanglement?", role: "user" },
];

function fallbackConfig(overrides: Partial<AiFallbackConfig> = {}): AiFallbackConfig {
  return {
    circuitBreakerCooldownMs: 60_000,
    circuitBreakerThreshold: 0,
    enabled: true,
    maxRetries: 1,
    models: [{ model: "gpt-5-mini", style: "chat-completions" }],
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("GoogleNativeProvider 503 Automatic Retry and Backoff", () => {
  it("implements Google's recommended retry sequence: 503 -> 503 -> 200", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    let callCount = 0;
    const fetcher: FetchLike = vi.fn(async (_url, _init) => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "The model is overloaded. Please try again later.",
              status: "UNAVAILABLE",
            },
          }),
          { status: 503 },
        );
      }
      if (callCount === 2) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: "The model is overloaded. Please try again later.",
              status: "UNAVAILABLE",
            },
          }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Entanglement is a physical phenomenon..." }],
                role: "model",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const provider = new GoogleNativeProvider(
      googleConfig(),
      fetcher,
      undefined,
      {
        jitterFn: () => 0.5,
        logger,
      },
    );

    const controller = new AbortController();
    const result = await provider.generate(SAMPLE_MESSAGES, controller.signal);

    expect(result).toBe("Entanglement is a physical phenomenon...");
    expect(fetcher).toHaveBeenCalledTimes(3);

    // Verify retry logs and absence of sensitive keys
    expect(logs.some((l) => l.includes("Google API returned HTTP 503 for model \"gemma-4-31b-it\" (attempt 1/3)"))).toBe(true);
    expect(logs.some((l) => l.includes("Google API returned HTTP 503 for model \"gemma-4-31b-it\" (attempt 2/3)"))).toBe(true);
    expect(logs.some((l) => l.includes("request succeeded for model \"gemma-4-31b-it\" on attempt 3 after 2 retries"))).toBe(true);

    for (const log of logs) {
      expect(log).not.toContain("test-google-key-12345");
      expect(log).not.toContain("x-goog-api-key");
    }
  });

  it("preserves conversation history, system instructions, and reply context across retries", async () => {
    let callCount = 0;
    const receivedBodies: Array<Record<string, unknown>> = [];

    const fetcher: FetchLike = vi.fn(async (_url, init) => {
      callCount++;
      if (init?.body && typeof init.body === "string") {
        receivedBodies.push(JSON.parse(init.body));
      }

      if (callCount < 3) {
        return new Response(
          JSON.stringify({ error: { code: 503, message: "Overloaded" } }),
          { status: 503 },
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Answer with preserved context" }],
                role: "model",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const provider = new GoogleNativeProvider(
      googleConfig({
        model: "gemini-2.5-flash",
      }),
      fetcher,
      undefined,
      { jitterFn: () => 0.5, logger: () => undefined },
    );

    const messages: ChatMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi! How can I help you?", role: "assistant" },
      { content: "[Replying to previous discussion]\nExplain wave-particle duality", role: "user" },
    ];

    const controller = new AbortController();
    const result = await provider.generate(messages, controller.signal);

    expect(result).toBe("Answer with preserved context");
    expect(receivedBodies).toHaveLength(3);

    // Each retry receives the exact same full payload including system instructions and conversation history
    for (const body of receivedBodies) {
      expect(body.systemInstruction).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
      const contents = body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents.length).toBeGreaterThanOrEqual(3);
      expect(contents.at(-1)?.parts[0]?.text).toContain("wave-particle duality");
    }
  });

  it("does not duplicate web search or tool executions during HTTP 503 retries", async () => {
    let callCount = 0;
    const toolSearchFn = vi.fn().mockResolvedValue([
      { title: "Live Event News", url: "https://news.gov/event" },
    ]);

    const mockSearchService = {
      formatResultsForPrompt: () => "Search results: Live event occurred today.",
      search: toolSearchFn,
    } as unknown as any;

    const fetcher: FetchLike = vi.fn(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init?.body as string);

      if (callCount === 1) {
        // Round 0: Model emits function call
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        args: { query: "breaking news" },
                        name: "web_search",
                      },
                    },
                  ],
                  role: "model",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (callCount === 2) {
        // Round 1 attempt 1: Google returns 503
        return new Response(
          JSON.stringify({ error: { code: 503, message: "Overloaded" } }),
          { status: 503 },
        );
      }

      // Round 1 attempt 2 (retry): Google returns 200 with final text
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "The event happened today based on live search." }],
                role: "model",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const provider = new GoogleNativeProvider(
      googleConfig({
        model: "gemini-2.5-flash",
        webSearchEnabled: true,
      }),
      fetcher,
      mockSearchService,
      { jitterFn: () => 0.5, logger: () => undefined },
    );

    const controller = new AbortController();
    const result = await provider.generate(
      [{ content: "Search for breaking news", role: "user" }],
      controller.signal,
    );

    expect(result).toContain("The event happened today");
    // Tool call was executed exactly ONCE, not duplicated on round 1's 503 retry!
    expect(toolSearchFn).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("exhausts retries and propagates final AiProviderError with status 503", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetcher: FetchLike = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: 503, message: "Google service is currently unavailable." },
        }),
        { status: 503 },
      ),
    );

    const provider = new GoogleNativeProvider(
      googleConfig({
        retry: {
          enabled: true,
          initialDelayMs: 5,
          maxAttempts: 3,
          maxDelayMs: 20,
          requestTimeoutMs: 1_000,
        },
      }),
      fetcher,
      undefined,
      { logger },
    );

    const controller = new AbortController();
    await expect(provider.generate(SAMPLE_MESSAGES, controller.signal)).rejects.toMatchObject({
      message: "Google service is currently unavailable.",
      name: "AiProviderError",
      status: 503,
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(logs.some((l) => l.includes("Google API retries exhausted for model \"gemma-4-31b-it\" after 3 attempts (HTTP 503)"))).toBe(true);
  });

  it.each([
    { category: "HTTP 503", status: 503 },
    { category: "HTTP 500", status: 500 },
    { category: "network_error", status: null },
  ])(
    "does not multiply exhausted Google retries for $category failures",
    async ({ category, status }) => {
      const logger = vi.fn();
      const fetcher = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes("gemma-4-31b-it")) {
          if (status === null) throw new TypeError("fetch failed");
          return new Response(JSON.stringify({
            error: { code: status, message: "Gemma unavailable", status: "UNAVAILABLE" },
          }), { status });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Backup answer", role: "assistant" } }],
        }));
      });
      const orchestrator = new FallbackOrchestrator(
        googleConfig(),
        fallbackConfig(),
        fetcher,
        undefined,
        {
          logger,
          retryBaseDelayMs: 0,
          retryMaxDelayMs: 0,
          googleOptions: { logger: vi.fn() },
        },
      );

      await expect(orchestrator.generate(SAMPLE_MESSAGES)).resolves.toBe("Backup answer");
      // Three primary requests, then one successful backup request.
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(logger).toHaveBeenCalledWith(`Primary model gemma-4-31b-it failed: ${category}`);
      expect(logger).toHaveBeenCalledWith("Switching to fallback model: gpt-5-mini");
    },
  );

  it.each([
    { status: 429, expectedCalls: 2 },
    { status: 502, expectedCalls: 3 },
  ])("preserves existing fallback handling for HTTP $status", async ({ status, expectedCalls }) => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("gemma-4-31b-it")) {
        return new Response(JSON.stringify({ error: { message: "Try again" } }), { status });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Backup answer", role: "assistant" } }],
      }));
    });
    const client = new AiClient(
      googleConfig({ fallback: fallbackConfig() }),
      fetcher,
      undefined,
      { logger: vi.fn(), retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
    );

    await expect(client.generate(SAMPLE_MESSAGES)).resolves.toBe("Backup answer");
    expect(fetcher).toHaveBeenCalledTimes(expectedCalls);
  });

  it.each(["legacy", "nested"])("forwards Google options in %s client options", async (style) => {
    const logger = vi.fn();
    const jitterFn = vi.fn(() => 0.5);
    let backupCalls = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const isPrimary = String(url).includes("gemma-4-31b-it");
      if (!isPrimary) backupCalls++;
      if (isPrimary || backupCalls === 1) {
        return new Response(JSON.stringify({ error: { message: "Overloaded" } }), { status: 503 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Backup answer" }] } }],
      }));
    });
    const fallbackOptions = { logger: vi.fn(), retryBaseDelayMs: 0, retryMaxDelayMs: 0 };
    const googleOptions = {
      jitterFn,
      logger,
      retryOptions: { initialDelayMs: 0, maxAttempts: 2, maxDelayMs: 0 },
    };
    const client = new AiClient(
      googleConfig({ fallback: fallbackConfig({
        models: [{ model: "gemini-2.5-flash", style: "google-native" }],
      }) }),
      fetcher,
      undefined,
      style === "legacy"
        ? { ...fallbackOptions, googleOptions }
        : { fallbackOptions, googleOptions },
    );

    await expect(client.generate(SAMPLE_MESSAGES)).resolves.toBe("Backup answer");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(jitterFn).toHaveBeenCalledTimes(2);
    expect(fallbackOptions.logger).toHaveBeenCalledWith("Switching to fallback model: gemini-2.5-flash");
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('model "gemma-4-31b-it" (attempt 1/2)'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('model "gemini-2.5-flash" (attempt 1/2)'));
  });

  it.each([false, true])("preserves request timeouts with fallback=%s", async (withFallback) => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        }),
      );
      const client = new AiClient(
        googleConfig({
          fallback: withFallback ? fallbackConfig({
            maxRetries: 2,
            models: [{ model: "gemini-2.5-flash", style: "google-native" }],
          }) : undefined,
          retry: {
            enabled: true,
            initialDelayMs: 0,
            maxAttempts: 2,
            maxDelayMs: 0,
            requestTimeoutMs: 25,
          },
        }),
        fetcher,
        undefined,
        {
          fallbackOptions: { logger: vi.fn(), retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
          googleOptions: { logger: vi.fn() },
        },
      );
      const result = client.generate(SAMPLE_MESSAGES).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await result;

      if (withFallback) {
        expect(error).toMatchObject({
          name: "AiAllModelsFailedError",
          attempts: [{ error: expect.any(AiTimeoutError) }, { error: expect.any(AiTimeoutError) }],
        });
      } else {
        expect(error).toBeInstanceOf(AiTimeoutError);
      }
      expect(fetcher).toHaveBeenCalledTimes(withFallback ? 4 : 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
