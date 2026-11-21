import { describe, expect, it, vi } from "vitest";
import {
  AiAllModelsFailedError,
  CircuitBreaker,
  classifyError,
  FallbackOrchestrator,
  resolveCandidates,
  canFallbackToCandidate,
  sleep,
} from "../src/fallback-orchestrator.js";
import {
  AiProviderError,
  AiRefusalError,
  AiTimeoutError,
  AiNetworkError,
  AiIncompleteResponseError,
} from "../src/ai-client.js";
import type { BotConfig, AiFallbackConfig } from "../src/config.js";
import type { FetchLike } from "../src/providers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function primaryConfig(overrides: Partial<BotConfig["ai"]> = {}): BotConfig["ai"] {
  return {
    apiKey: "primary-key",
    baseUrl: "https://primary.example.test/v1",
    chatTokenField: "auto",
    fallback: undefined,
    maxOutputTokens: 200,
    model: "primary-model",
    reasoningEffort: "off",
    style: "chat-completions",
    systemPrompt: "You are helpful.",
    timeoutMs: 2_000,
    webSearchEnabled: false,
    ...overrides,
  };
}

function fallbackConfig(overrides: Partial<AiFallbackConfig> = {}): AiFallbackConfig {
  return {
    circuitBreakerCooldownMs: 60_000,
    circuitBreakerThreshold: 0, // disabled by default in most tests
    enabled: true,
    maxRetries: 1,
    models: [],
    timeoutMs: 5_000,
    ...overrides,
  };
}

/** Builds a mock fetcher that returns successive responses in order */
function mockFetcher(...responses: Array<{ body: unknown; status: number }>): FetchLike {
  let call = 0;
  return vi.fn(async () => {
    const r = responses[call] ?? responses.at(-1)!;
    call++;
    const bodyStr = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(bodyStr, { status: r.status });
  });
}

function okBody(text: string) {
  return {
    choices: [{ message: { content: text, role: "assistant" } }],
  };
}

function errorBody(message: string) {
  return { error: { message } };
}

const USER_MSG = [{ content: "hello", role: "user" as const }];

// ---------------------------------------------------------------------------
// 1. Primary model succeeds — fallback is not used
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — primary succeeds", () => {
  it("returns primary result and does not call fallback model", async () => {
    const fetcher = mockFetcher({ body: okBody("hi there"), status: 200 });

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
    );

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("hi there");
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Primary returns HTTP 503 — backup model succeeds
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — 503 triggers fallback", () => {
  it("retries primary then switches to fallback and returns fallback answer", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetcher = mockFetcher(
      { body: errorBody("Service overloaded"), status: 503 }, // primary attempt 1
      { body: errorBody("Service overloaded"), status: 503 }, // primary retry (maxRetries=1)
      { body: okBody("fallback answer"), status: 200 },       // fallback attempt 1
    );

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 1,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
      undefined,
      { logger, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
    );

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("fallback answer");

    expect(logs.some((l) => l.includes("Primary model primary-model failed: HTTP 503"))).toBe(true);
    expect(logs.some((l) => l.includes("Retrying primary model: attempt 2"))).toBe(true);
    expect(logs.some((l) => l.includes("Switching to fallback model: fallback-model"))).toBe(true);
    expect(logs.some((l) => l.includes("Fallback model succeeded"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Primary returns HTTP 429 — eligible backup is attempted
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — 429 triggers fallback", () => {
  it("skips retry on rate-limited primary and moves to fallback", async () => {
    const logs: string[] = [];
    const fetcher = mockFetcher(
      { body: errorBody("quota exceeded"), status: 429 }, // primary
      { body: okBody("ok from fallback"), status: 200 },  // fallback
    );

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 1,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
      undefined,
      { logger: (m) => logs.push(m), retryBaseDelayMs: 0 },
    );

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("ok from fallback");
    // 429 is not retryable on same model — only primary + fallback = 2 fetcher calls
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. First fallback fails — second fallback succeeds
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — chained fallbacks", () => {
  it("continues through failed fallbacks until one succeeds", async () => {
    const logs: string[] = [];
    const fetcher = mockFetcher(
      { body: errorBody("overloaded"), status: 503 },      // primary
      { body: errorBody("also overloaded"), status: 503 }, // fallback-1
      { body: okBody("second fallback works"), status: 200 },
    );

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 0,
        models: [
          { model: "fallback-1", style: "chat-completions", timeoutMs: 5_000 },
          { model: "fallback-2", style: "chat-completions", timeoutMs: 5_000 },
        ],
      }),
      fetcher,
      undefined,
      { logger: (m) => logs.push(m), retryBaseDelayMs: 0 },
    );

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("second fallback works");
    expect(logs.some((l) => l.includes("Fallback model succeeded"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. All models fail — appropriate final error
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — all models fail", () => {
  it("throws AiAllModelsFailedError with attempt records when every model fails", async () => {
    const fetcher = mockFetcher(
      { body: errorBody("gone"), status: 503 },
      { body: errorBody("gone too"), status: 503 },
    );

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 0,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
      undefined,
      { retryBaseDelayMs: 0 },
    );

    const error = await orch.generate(USER_MSG).catch((e) => e);
    expect(error).toBeInstanceOf(AiAllModelsFailedError);
    expect((error as AiAllModelsFailedError).attempts).toHaveLength(2);
    expect((error as AiAllModelsFailedError).attempts[0]?.model).toBe("primary-model");
    expect((error as AiAllModelsFailedError).attempts[1]?.model).toBe("fallback-model");
  });

  it("logs that all configured models failed", async () => {
    const logs: string[] = [];
    const fetcher = mockFetcher({ body: errorBody("gone"), status: 503 });

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({ maxRetries: 0, models: [] }),
      fetcher,
      undefined,
      { logger: (m) => logs.push(m), retryBaseDelayMs: 0 },
    );

    await orch.generate(USER_MSG).catch(() => undefined);
    expect(logs.some((l) => l.toLowerCase().includes("all configured ai models failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid API key — no retry loop (401/403 stops)
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — invalid credentials", () => {
  it("does not retry or fall back when primary returns 401 with no alternative key", async () => {
    const fetcher = mockFetcher({ body: errorBody("Invalid API key"), status: 401 });

    // Fallback model uses the SAME key (no distinct key/endpoint)
    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 1,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
      undefined,
      { retryBaseDelayMs: 0 },
    );

    const error = await orch.generate(USER_MSG).catch((e) => e);
    // Should throw AiProviderError 401 immediately without touching fallback
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).status).toBe(401);
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("falls back when next candidate has a distinct API key", async () => {
    const fetcher = mockFetcher(
      { body: errorBody("Invalid API key"), status: 401 },
      { body: okBody("ok with other key"), status: 200 },
    );

    const orch = new FallbackOrchestrator(
      primaryConfig({ apiKey: "bad-key" }),
      fallbackConfig({
        maxRetries: 0,
        models: [
          {
            apiKey: "good-key",   // distinct key — fallback allowed
            model: "fallback-model",
            style: "chat-completions",
            timeoutMs: 5_000,
          },
        ],
      }),
      fetcher,
      undefined,
      { retryBaseDelayMs: 0 },
    );

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("ok with other key");
  });
});

// ---------------------------------------------------------------------------
// 7. Timeout — request terminates within configured limits
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — timeout handling", () => {
  it("throws AiTimeoutError when provider hangs beyond timeoutMs", async () => {
    const hangFetcher: FetchLike = vi.fn(
      () => new Promise<Response>(() => { /* never resolves */ }),
    );

    const orch = new FallbackOrchestrator(
      primaryConfig({ timeoutMs: 20 }),
      fallbackConfig({ maxRetries: 0, models: [], timeoutMs: 20 }),
      hangFetcher,
      undefined,
      { retryBaseDelayMs: 0 },
    );

    const error = await orch.generate(USER_MSG).catch((e) => e);
    expect(error).toBeInstanceOf(AiAllModelsFailedError);
    const inner = (error as AiAllModelsFailedError).attempts[0]?.error;
    expect(inner).toBeInstanceOf(AiTimeoutError);
  });

  it("retries on timeout then falls back", async () => {
    const logs: string[] = [];
    let calls = 0;
    const fetcher: FetchLike = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        await new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("aborted")), 5),
        );
      }
      return new Response(JSON.stringify(okBody("success")), { status: 200 });
    });

    const orch = new FallbackOrchestrator(
      primaryConfig({ timeoutMs: 10 }),
      fallbackConfig({
        maxRetries: 1,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 2_000 }],
        timeoutMs: 2_000,
      }),
      fetcher,
      undefined,
      { logger: (m) => logs.push(m), retryBaseDelayMs: 0 },
    );

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// 8. Fallback disabled — existing behavior remains unchanged
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — fallback disabled", () => {
  it("only primary model is in candidates when disabled", () => {
    const cfg = primaryConfig();
    const fbCfg = fallbackConfig({ enabled: false, models: [{ model: "fb", style: "chat-completions" }] });
    const candidates = resolveCandidates(cfg, fbCfg);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.model).toBe("primary-model");
  });

  it("only primary model is in candidates when no fallback models configured", () => {
    const cfg = primaryConfig();
    const fbCfg = fallbackConfig({ enabled: true, models: [] });
    const candidates = resolveCandidates(cfg, fbCfg);
    expect(candidates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Reply context and memory are preserved across model calls
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — message context preservation", () => {
  it("passes the full message array including history/context to fallback provider", async () => {
    let capturedMessages: readonly { content: string | null | unknown; role: string }[] = [];

    const fetcher: FetchLike = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: typeof capturedMessages };
      capturedMessages = body.messages;
      const callCount = (fetcher as ReturnType<typeof vi.fn>).mock.calls.length;
      if (callCount <= 1) {
        return new Response(JSON.stringify(errorBody("unavailable")), { status: 503 });
      }
      return new Response(JSON.stringify(okBody("response with context")), { status: 200 });
    });

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 0,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
      undefined,
      { retryBaseDelayMs: 0 },
    );

    const richMessages = [
      { content: "previous turn", role: "user" as const },
      { content: "my previous answer", role: "assistant" as const },
      { content: "[Memory: X=Y]\n[Reply context]\nhello", role: "user" as const },
    ];

    const result = await orch.generate(richMessages);
    expect(result).toBe("response with context");
    // Fallback received all messages including history and context
    expect(capturedMessages.length).toBe(4); // system + 3 user/assistant turns
    const lastMsg = capturedMessages.at(-1) as { content: string };
    expect(lastMsg.content).toContain("hello");
  });
});

// ---------------------------------------------------------------------------
// 10. Tool calls are not duplicated
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — tool call deduplication", () => {
  it("does not replay tool results when falling back after a failed primary", async () => {
    // Simulate: primary fails with 503 BEFORE any tool execution
    // Fallback gets the same original clean messages
    let fallbackReceivedMessages: unknown[] = [];

    const fetcher: FetchLike = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const msgs = body.messages as unknown[];
      const callCount = (fetcher as ReturnType<typeof vi.fn>).mock.calls.length;
      if (callCount <= 1) {
        return new Response(JSON.stringify(errorBody("503")), { status: 503 });
      }
      fallbackReceivedMessages = msgs;
      return new Response(JSON.stringify(okBody("clean fallback")), { status: 200 });
    });

    const orch = new FallbackOrchestrator(
      primaryConfig(),
      fallbackConfig({
        maxRetries: 0,
        models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
      }),
      fetcher,
      undefined,
      { retryBaseDelayMs: 0 },
    );

    const originalMessages = [
      { content: "run tool X", role: "user" as const },
    ];

    await orch.generate(originalMessages);
    // Fallback gets original messages unchanged (system + 1 user)
    expect(fallbackReceivedMessages.length).toBe(2);
    // No duplicate tool result messages injected
    const hasToolRole = fallbackReceivedMessages.some(
      (m) => (m as Record<string, unknown>).role === "tool",
    );
    expect(hasToolRole).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Models with different capabilities (google-native vs chat-completions)
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — cross-style provider configuration", () => {
  it("resolves google-native fallback with correct default base URL", () => {
    const primary = primaryConfig({ style: "chat-completions" });
    const fbCfg = fallbackConfig({
      models: [{ model: "gemini-2.5-flash", style: "google-native" }],
    });

    const candidates = resolveCandidates(primary, fbCfg);
    expect(candidates).toHaveLength(2);
    const fb = candidates[1]!;
    expect(fb.style).toBe("google-native");
    expect(fb.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(fb.model).toBe("gemini-2.5-flash");
  });

  it("auto-detects google-native style for gemma/gemini models when primary uses chat-completions", () => {
    const primary = primaryConfig({ style: "chat-completions" });
    const fbCfg = fallbackConfig({
      models: [{ model: "gemma-4-31b-it" }],
    });

    const candidates = resolveCandidates(primary, fbCfg);
    // gemma name auto-detected
    expect(candidates[1]?.style).toBe("google-native");
  });

  it("inherits primary style when fallback model style is not specified and name is not google", () => {
    const primary = primaryConfig({ style: "chat-completions" });
    const fbCfg = fallbackConfig({
      models: [{ model: "llama-3.3-70b" }],
    });

    const candidates = resolveCandidates(primary, fbCfg);
    expect(candidates[1]?.style).toBe("chat-completions");
  });

  it("retains primary system prompt in fallback candidate", () => {
    const primary = primaryConfig({ systemPrompt: "Be a helpful bot." });
    const fbCfg = fallbackConfig({
      models: [{ model: "fallback-model", style: "chat-completions" }],
    });

    const candidates = resolveCandidates(primary, fbCfg);
    expect(candidates[1]?.systemPrompt).toBe("Be a helpful bot.");
  });
});

// ---------------------------------------------------------------------------
// 12. Cross-provider fallback configured correctly
// ---------------------------------------------------------------------------

describe("FallbackOrchestrator — cross-provider fallback", () => {
  it("uses different API key and endpoint for cross-provider fallback", () => {
    const primary = primaryConfig({
      apiKey: "google-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemma-4-31b-it",
      style: "google-native",
    });

    const fbCfg = fallbackConfig({
      models: [
        {
          apiKey: "openai-key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5-mini",
          style: "responses",
        },
      ],
    });

    const candidates = resolveCandidates(primary, fbCfg);
    expect(candidates).toHaveLength(2);
    const fb = candidates[1]!;
    expect(fb.apiKey).toBe("openai-key");
    expect(fb.baseUrl).toBe("https://api.openai.com/v1");
    expect(fb.style).toBe("responses");
    expect(fb.model).toBe("gpt-5-mini");
  });

  it("makes actual HTTP call to fallback provider using its distinct endpoint", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = vi.fn(async (url) => {
      const urlStr = String(url);
      calls.push(urlStr);
      if (urlStr.includes("primary")) {
        return new Response(JSON.stringify(errorBody("503")), { status: 503 });
      }
      // This is the cross-provider fallback endpoint
      return new Response(JSON.stringify(okBody("from openai")), { status: 200 });
    });

    const primary = primaryConfig({
      apiKey: "primary-key",
      baseUrl: "https://primary.example.test/v1",
      model: "primary-model",
      style: "chat-completions",
    });

    const fbCfg = fallbackConfig({
      maxRetries: 0,
      models: [
        {
          apiKey: "openai-key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5-mini",
          style: "chat-completions",
        },
      ],
    });

    const orch = new FallbackOrchestrator(primary, fbCfg, fetcher, undefined, {
      retryBaseDelayMs: 0,
    });

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("from openai");
    expect(calls[0]).toContain("primary.example.test");
    expect(calls[1]).toContain("openai.com");
  });
});

// ---------------------------------------------------------------------------
// classifyError — unit tests
// ---------------------------------------------------------------------------

describe("classifyError", () => {
  it.each([
    [new AiProviderError("Service overloaded", 503), "service_unavailable", true, true],
    [new AiProviderError("Rate limited", 429), "rate_limited", true, false],
    [new AiProviderError("Not found", 404), "model_not_found", true, false],
    [new AiProviderError("Bad gateway", 502), "service_unavailable", true, true],
    [new AiProviderError("Gateway timeout", 504), "service_unavailable", true, true],
    [new AiProviderError("Internal error", 500), "service_unavailable", true, true],
    [new AiProviderError("Unauthorized", 401), "unauthorized", false, false],
    [new AiProviderError("Forbidden", 403), "unauthorized", false, false],
    [new AiProviderError("Bad request", 400), "bad_request", false, false],
    [new AiTimeoutError(), "timeout", true, true],
    [new AiNetworkError(), "network_error", true, true],
    [new AiRefusalError(), "refusal", false, false],
    [new AiIncompleteResponseError(), "incomplete", false, false],
  ] as const)(
    "classifies %s correctly",
    (error, expectedCategory, expectedFallback, expectedRetry) => {
      const result = classifyError(error);
      expect(result.category).toBe(expectedCategory);
      expect(result.isEligibleForFallback).toBe(expectedFallback);
      expect(result.isRetryableOnSameModel).toBe(expectedRetry);
    },
  );
});

// ---------------------------------------------------------------------------
// CircuitBreaker — unit tests
// ---------------------------------------------------------------------------

describe("CircuitBreaker", () => {
  it("stays closed below threshold", () => {
    const cb = new CircuitBreaker({ cooldownMs: 60_000, threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
  });

  it("opens at or above threshold", () => {
    const cb = new CircuitBreaker({ cooldownMs: 60_000, threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
  });

  it("closes again after cooldown period", () => {
    const cb = new CircuitBreaker({ cooldownMs: 1, threshold: 1 });
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.isOpen()).toBe(false);
        resolve();
      }, 10);
    });
  });

  it("resets on success", () => {
    const cb = new CircuitBreaker({ cooldownMs: 60_000, threshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
    cb.recordSuccess();
    expect(cb.isOpen()).toBe(false);
    expect(cb.getConsecutiveFailures()).toBe(0);
  });

  it("is always closed when threshold=0 (disabled)", () => {
    const cb = new CircuitBreaker({ cooldownMs: 60_000, threshold: 0 });
    for (let i = 0; i < 20; i++) cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
  });

  it("when open, orchestrator skips primary and goes straight to first fallback", async () => {
    const logs: string[] = [];
    const fetcher: FetchLike = vi.fn(async (_url) => {
      const callCount = (fetcher as ReturnType<typeof vi.fn>).mock.calls.length;
      if (callCount === 1) {
        // This should be the fallback, not primary
        return new Response(JSON.stringify(okBody("fallback response")), { status: 200 });
      }
      return new Response(JSON.stringify(errorBody("Should not be called")), { status: 500 });
    });

    const primary = primaryConfig();
    const fbCfg = fallbackConfig({
      circuitBreakerCooldownMs: 60_000,
      circuitBreakerThreshold: 1,
      maxRetries: 0,
      models: [{ model: "fallback-model", style: "chat-completions", timeoutMs: 5_000 }],
    });

    const orch = new FallbackOrchestrator(primary, fbCfg, fetcher, undefined, {
      logger: (m) => logs.push(m),
      retryBaseDelayMs: 0,
    });

    // Artificially trip the circuit breaker
    orch.getCircuitBreaker().recordFailure();
    expect(orch.getCircuitBreaker().isOpen()).toBe(true);

    const result = await orch.generate(USER_MSG);
    expect(result).toBe("fallback response");
    expect(logs.some((l) => l.includes("Circuit breaker OPEN"))).toBe(true);
    // Only 1 HTTP call (fallback) — primary was skipped
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// canFallbackToCandidate
// ---------------------------------------------------------------------------

describe("canFallbackToCandidate", () => {
  const makeCandidate = (overrides: Partial<Parameters<typeof canFallbackToCandidate>[1]> = {}) => ({
    apiKey: "key",
    baseUrl: "https://a.test/v1",
    chatTokenField: "auto" as const,
    maxOutputTokens: 200,
    model: "model-a",
    reasoningEffort: "off" as const,
    style: "chat-completions" as const,
    systemPrompt: "prompt",
    timeoutMs: 5_000,
    webSearchEnabled: false,
    ...overrides,
  });

  it("allows fallback for 503", () => {
    expect(
      canFallbackToCandidate(
        new AiProviderError("503", 503),
        makeCandidate(),
        makeCandidate({ model: "model-b" }),
      ),
    ).toBe(true);
  });

  it("blocks fallback for refusal", () => {
    expect(
      canFallbackToCandidate(
        new AiRefusalError(),
        makeCandidate(),
        makeCandidate({ model: "model-b" }),
      ),
    ).toBe(false);
  });

  it("allows 401 fallback when next candidate has different key", () => {
    expect(
      canFallbackToCandidate(
        new AiProviderError("401", 401),
        makeCandidate({ apiKey: "bad-key" }),
        makeCandidate({ apiKey: "good-key", model: "model-b" }),
      ),
    ).toBe(true);
  });

  it("blocks 401 fallback when both candidates share the same key", () => {
    expect(
      canFallbackToCandidate(
        new AiProviderError("401", 401),
        makeCandidate({ apiKey: "key" }),
        makeCandidate({ apiKey: "key", model: "model-b" }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sleep utility
// ---------------------------------------------------------------------------

describe("sleep", () => {
  it("resolves after the specified delay", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });

  it("resolves immediately when delay is 0", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it("rejects when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1_000, controller.signal)).rejects.toThrow();
  });
});
