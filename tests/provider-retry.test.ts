import { describe, expect, it, vi } from "vitest";
import { AiClient } from "../src/ai-client.js";
import type { BotConfig } from "../src/config.js";

const messages = [{ content: "hello", role: "user" as const }];
const success = () => new Response(JSON.stringify({
  output_text: "Answer",
  choices: [{ message: { content: "Answer" } }],
  candidates: [{ content: { parts: [{ text: "Answer" }] } }],
}));

function config(style: BotConfig["ai"]["style"]): BotConfig["ai"] {
  return {
    apiKey: "test-key",
    baseUrl: "https://provider.example/v1",
    chatTokenField: "auto",
    maxOutputTokens: 200,
    model: "primary-model",
    reasoningEffort: "off",
    retry: {
      enabled: true,
      initialDelayMs: 0,
      maxAttempts: 3,
      maxDelayMs: 0,
      requestTimeoutMs: 1_000,
    },
    style,
    systemPrompt: "Be helpful.",
    timeoutMs: 5_000,
    webSearchEnabled: false,
  };
}

describe.each(["responses", "chat-completions", "google-native"] as const)(
  "%s shared provider retries",
  (style) => {
    it.each([429, 500, 502, 503, 504])("retries HTTP %s with the same request", async (status) => {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
        .mockResolvedValueOnce(new Response('{"message":"Try later"}', { status }));
      const client = new AiClient(config(style), fetcher, undefined, {
        providerOptions: { logger: vi.fn() },
      });

      await expect(client.generate(messages)).resolves.toBe("Answer");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0]?.[0]).toBe(fetcher.mock.calls[1]?.[0]);
      expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    });

    it.each([400, 401, 403, 404])("does not retry permanent HTTP %s errors", async (status) => {
      const fetcher = vi.fn(async () => new Response('{"message":"Rejected"}', {
        status,
        headers: { "x-request-id": "request-123" },
      }));
      const client = new AiClient(config(style), fetcher);

      await expect(client.generate(messages)).rejects.toMatchObject({
        name: "AiProviderError", status, requestId: "request-123", retriesExhausted: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each(["legacy", "nested"])("forwards %s provider options to fallback models without multiplying retries", async (shape) => {
      const aiConfig = config(style);
      aiConfig.fallback = {
        enabled: true,
        maxRetries: 2,
        models: [{ model: "backup-model", style }],
        timeoutMs: 5_000,
        circuitBreakerThreshold: 0,
        circuitBreakerCooldownMs: 60_000,
      };
      let backupAttempts = 0;
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        const primary = style === "google-native"
          ? String(_input).includes("primary-model")
          : body.model === "primary-model";
        if (primary || ++backupAttempts === 1) {
          return new Response('{"error":{"message":"Unavailable"}}', { status: 503 });
        }
        return success();
      });
      const providerOptions = { logger: vi.fn(), retryOptions: { maxAttempts: 2 } };
      const fallbackOptions = { logger: vi.fn(), retryBaseDelayMs: 0, retryMaxDelayMs: 0 };
      const client = new AiClient(aiConfig, fetcher, undefined, shape === "nested"
        ? { fallbackOptions: { ...fallbackOptions, providerOptions } }
        : { ...fallbackOptions, providerOptions });

      await expect(client.generate(messages)).resolves.toBe("Answer");
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(providerOptions.logger).toHaveBeenCalledWith(expect.stringContaining("after 2 attempts"));
      expect(providerOptions.logger).toHaveBeenCalledWith(expect.stringContaining('model "backup-model" on attempt 2'));
      expect(fallbackOptions.logger).toHaveBeenCalledWith("Switching to fallback model: backup-model");
    });
  },
);
