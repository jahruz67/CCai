import { describe, expect, it, vi } from "vitest";
import {
  computeBackoffDelay,
  DEFAULT_AI_RETRY_CONFIG,
  executeFetchWithRetry,
  extractServerRetryDelay,
  isTransientGoogleError,
  parseDurationToMs,
} from "../src/retry-strategy.js";
import { AiProviderError, AiTimeoutError } from "../src/ai-errors.js";

describe("computeBackoffDelay", () => {
  it("calculates exponential backoff for conservative defaults without jitter", () => {
    // jitterFn returning 0.5 gives exact midpoint (1.0x multiplier, no jitter offset)
    const midJitter = () => 0.5;

    // Retry 1 (retryIndex 0): initialDelayMs * 2^0 = 1000ms
    expect(computeBackoffDelay(0, 1_000, 4_000, midJitter)).toBe(1_000);

    // Retry 2 (retryIndex 1): initialDelayMs * 2^1 = 2000ms
    expect(computeBackoffDelay(1, 1_000, 4_000, midJitter)).toBe(2_000);

    // Retry 3 (retryIndex 2): initialDelayMs * 2^2 = 4000ms (capped at maxDelayMs)
    expect(computeBackoffDelay(2, 1_000, 4_000, midJitter)).toBe(4_000);

    // Further retries stay capped at maxDelayMs
    expect(computeBackoffDelay(3, 1_000, 4_000, midJitter)).toBe(4_000);
  });

  it("applies proportional jitter within ±20% bounds", () => {
    const minJitter = () => 0.0; // 0.8x
    const maxJitter = () => 1.0; // 1.2x

    // 1000ms base
    expect(computeBackoffDelay(0, 1_000, 4_000, minJitter)).toBe(800);
    expect(computeBackoffDelay(0, 1_000, 4_000, maxJitter)).toBe(1_200);

    // 2000ms base
    expect(computeBackoffDelay(1, 1_000, 4_000, minJitter)).toBe(1_600);
    expect(computeBackoffDelay(1, 1_000, 4_000, maxJitter)).toBe(2_400);

    // 4000ms base capped at maxDelayMs
    expect(computeBackoffDelay(2, 1_000, 4_000, minJitter)).toBe(3_200);
    expect(computeBackoffDelay(2, 1_000, 4_000, maxJitter)).toBe(4_000); // capped at 4000
  });

  it("respects custom initial and max delays", () => {
    const midJitter = () => 0.5;
    expect(computeBackoffDelay(0, 500, 2_000, midJitter)).toBe(500);
    expect(computeBackoffDelay(1, 500, 2_000, midJitter)).toBe(1_000);
    expect(computeBackoffDelay(2, 500, 2_000, midJitter)).toBe(2_000);
    expect(computeBackoffDelay(3, 500, 2_000, midJitter)).toBe(2_000);
  });
});

describe("parseDurationToMs and extractServerRetryDelay", () => {
  it("parses different duration formats into milliseconds", () => {
    expect(parseDurationToMs("2.5s")).toBe(2_500);
    expect(parseDurationToMs("2s")).toBe(2_000);
    expect(parseDurationToMs("500ms")).toBe(500);
    expect(parseDurationToMs("3")).toBe(3_000);
    expect(parseDurationToMs(1.5)).toBe(1_500);
    expect(parseDurationToMs({ seconds: 2, nanos: 500_000_000 })).toBe(2_500);
    expect(parseDurationToMs({ seconds: 1 })).toBe(1_000);
    expect(parseDurationToMs(null)).toBeUndefined();
    expect(parseDurationToMs("invalid")).toBeUndefined();
  });

  it("extracts delay from Retry-After header as seconds", () => {
    const response = new Response("{}", {
      headers: { "Retry-After": "3" },
      status: 503,
    });
    expect(extractServerRetryDelay(response)).toBe(3_000);
  });

  it("extracts delay from Retry-After header as HTTP date", () => {
    const futureDate = new Date(Date.now() + 5_000).toUTCString();
    const response = new Response("{}", {
      headers: { "Retry-After": futureDate },
      status: 503,
    });
    const delay = extractServerRetryDelay(response);
    expect(delay).toBeDefined();
    expect(delay).toBeGreaterThan(3_000);
    expect(delay).toBeLessThanOrEqual(6_000);
  });

  it("extracts delay from Google RPC RetryInfo in error details", () => {
    const response = new Response("{}", { status: 503 });
    const data = {
      error: {
        code: 503,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "1.5s",
          },
        ],
        message: "The model is overloaded.",
        status: "UNAVAILABLE",
      },
    };
    expect(extractServerRetryDelay(response, data)).toBe(1_500);
  });

  it("extracts delay from error.retryDelay directly", () => {
    const response = new Response("{}", { status: 503 });
    const data = {
      error: {
        code: 503,
        message: "Service overloaded",
        retryDelay: "2s",
      },
    };
    expect(extractServerRetryDelay(response, data)).toBe(2_000);
  });

  it("returns undefined when no server delay is indicated", () => {
    const response = new Response("{}", { status: 503 });
    expect(extractServerRetryDelay(response, {})).toBeUndefined();
  });
});

describe("isTransientGoogleError", () => {
  it("identifies HTTP 503 as transient", () => {
    expect(isTransientGoogleError(503)).toBe(true);
    expect(isTransientGoogleError(503, { error: { message: "Unavailable" } })).toBe(true);
  });

  it("identifies Google error with status UNAVAILABLE or code 503 as transient", () => {
    expect(isTransientGoogleError(500, { error: { status: "UNAVAILABLE" } })).toBe(true);
    expect(isTransientGoogleError(500, { error: { code: 503 } })).toBe(true);
  });

  it("does not classify client or quota errors as transient for 503 retry", () => {
    expect(isTransientGoogleError(400)).toBe(false);
    expect(isTransientGoogleError(401)).toBe(false);
    expect(isTransientGoogleError(404)).toBe(false);
    expect(isTransientGoogleError(429)).toBe(false);
  });
});

describe("executeFetchWithRetry", () => {
  const defaultRetryConfig = {
    enabled: true,
    initialDelayMs: 10, // low delay for fast tests
    maxAttempts: 3,
    maxDelayMs: 40,
    requestTimeoutMs: 1_000,
  };

  it("succeeds on first attempt without retrying", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello" }] } }] }), {
        status: 200,
      }),
    );

    const result = await executeFetchWithRetry(fetchFn, {
      jitterFn: () => 0.5,
      logger,
      model: "gemini-2.5-flash",
      retryConfig: defaultRetryConfig,
    });

    expect(result.response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(0);
  });

  it("implements expected retry behavior: Request 1 (503) -> Request 2 (503) -> Request 3 (200)", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    let callCount = 0;
    const fetchFn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: { code: 503, message: "The model is overloaded." } }), {
          status: 503,
        });
      }
      if (callCount === 2) {
        return new Response(JSON.stringify({ error: { code: 503, message: "The model is overloaded." } }), {
          status: 503,
        });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Success after retries" }] } }] }), {
        status: 200,
      });
    });

    const result = await executeFetchWithRetry(fetchFn, {
      jitterFn: () => 0.5,
      logger,
      model: "gemma-4-31b-it",
      retryConfig: defaultRetryConfig,
    });

    expect(result.response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    // Verify logs
    expect(logs.some((l) => l.includes("AI provider returned HTTP 503 for model \"gemma-4-31b-it\" (attempt 1/3)"))).toBe(true);
    expect(logs.some((l) => l.includes("AI provider returned HTTP 503 for model \"gemma-4-31b-it\" (attempt 2/3)"))).toBe(true);
    expect(logs.some((l) => l.includes("AI provider request succeeded for model \"gemma-4-31b-it\" on attempt 3 after 2 retries"))).toBe(true);
    // Sensitive information check: ensure no API keys or secrets are logged
    for (const log of logs) {
      expect(log).not.toContain("key");
      expect(log).not.toContain("AIza");
    }
  });

  it("exhausts retries when all attempts fail with 503 and propagates final error", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 503, message: "Google service unavailable." } }), {
        status: 503,
      }),
    );

    await expect(
      executeFetchWithRetry(fetchFn, {
        jitterFn: () => 0.5,
        logger,
        model: "gemma-4-31b-it",
        retryConfig: defaultRetryConfig,
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      retriesExhausted: true,
      status: 503,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(logs.some((l) => l.includes("AI provider retries exhausted for model \"gemma-4-31b-it\" after 3 attempts (HTTP 503)"))).toBe(true);
  });

  it("does not retry when AI_RETRY_ENABLED is false", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 503, message: "Service overloaded." } }), {
        status: 503,
      }),
    );

    await expect(
      executeFetchWithRetry(fetchFn, {
        logger,
        model: "gemma-4-31b-it",
        retryConfig: {
          ...defaultRetryConfig,
          enabled: false,
        },
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      retriesExhausted: false,
      status: 503,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("respects server-provided retry delay from Retry-After header", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    let callCount = 0;
    const fetchFn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: { message: "Overloaded" } }), {
          headers: { "Retry-After": "0.02" }, // 20ms
          status: 503,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await executeFetchWithRetry(fetchFn, {
      logger,
      model: "gemini-2.5-flash",
      retryConfig: defaultRetryConfig,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("Retrying in 20ms"))).toBe(true);
  });

  it("respects server-provided retry delay from Google RPC RetryInfo", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    let callCount = 0;
    const fetchFn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.RetryInfo",
                  retryDelay: "25ms",
                },
              ],
              message: "Temporarily unavailable",
            },
          }),
          { status: 503 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await executeFetchWithRetry(fetchFn, {
      logger,
      model: "gemini-2.5-flash",
      retryConfig: defaultRetryConfig,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("Retrying in 25ms"))).toBe(true);
  });

  it("does not retry non-503 errors such as 400 or 401", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), {
        status: 400,
      }),
    );

    await expect(
      executeFetchWithRetry(fetchFn, {
        logger,
        model: "gemini-2.5-flash",
        retryConfig: defaultRetryConfig,
      }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      status: 401,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(0);
  });

  it("handles request timeout and retries when attempt exceeds requestTimeoutMs", async () => {
    const logs: string[] = [];
    const logger = (msg: string) => logs.push(msg);

    let callCount = 0;
    const fetchFn = vi.fn(async (signal: AbortSignal) => {
      callCount++;
      if (callCount === 1) {
        // Hang until aborted by requestTimeoutMs
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await executeFetchWithRetry(fetchFn, {
      jitterFn: () => 0.5,
      logger,
      model: "gemini-2.5-flash",
      retryConfig: {
        ...defaultRetryConfig,
        initialDelayMs: 5,
        maxAttempts: 2,
        requestTimeoutMs: 25, // 25ms timeout
      },
    });

    expect(result.response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("timed out after 25ms"))).toBe(true);
    expect(logs.some((l) => l.includes("request succeeded for model \"gemini-2.5-flash\" on attempt 2"))).toBe(true);
  });

  it("aborts immediately when parent signal is aborted", async () => {
    const parentController = new AbortController();

    const fetchFn = vi.fn(async () => {
      parentController.abort();
      return new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 });
    });

    await expect(
      executeFetchWithRetry(fetchFn, {
        model: "gemini-2.5-flash",
        parentSignal: parentController.signal,
        retryConfig: defaultRetryConfig,
      }),
    ).rejects.toThrow(/aborted/i);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
