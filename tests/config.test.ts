import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig database SSL", () => {
  it.each([
    [undefined, false],
    ["false", false],
    ["true", true],
  ])("parses DATABASE_SSL=%s as %s", (value, expected) => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      DATABASE_URL: "postgresql://ccai:password@postgres:5432/ccai",
      DATABASE_SSL: value,
    });

    expect(config.memory.enabled).toBe(true);
    expect(config.memory.ssl).toBe(expected);
  });

  it("rejects invalid DATABASE_SSL values", () => {
    expect(() => loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      DATABASE_SSL: "yes",
    })).toThrow("DATABASE_SSL");
  });

  it("preserves the legacy database URL and memory toggle", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      MEMORY_DATABASE_URL: "postgresql://ccai:password@postgres:5432/ccai",
      MEMORY_ENABLED: "false",
      DATABASE_SSL: "true",
    });

    expect(config.memory.databaseUrl).toContain("@postgres:5432/ccai");
    expect(config.memory.enabled).toBe(false);
    expect(config.memory.ssl).toBe(true);
  });
});

describe("loadConfig Compose defaults", () => {
  it("accepts the default environment from docker-compose.yml", () => {
    const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
    const defaults = Object.fromEntries(
      [...compose.matchAll(/^\s+- ([A-Z_]+)=\$\{[A-Z_]+(?::-([^}]*))?\}$/gm)]
        .map((match) => [match[1]!, match[2] ?? ""]),
    );
    // Ensure this exercises the empty value that previously blocked deployment.
    expect(defaults.AI_FALLBACK_API_STYLE).toBe("");

    const config = loadConfig({
      ...defaults,
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.style).toBe("responses");
    expect(config.ai.fallback?.models).toEqual([]);
  });

  it("accepts empty optional provider URLs supplied by Docker Compose", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      AI_API_STYLE: "google-native",
      AI_BASE_URL: "",
      AI_FALLBACK_BASE_URL: "",
    });

    expect(config.ai.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });
});

describe("loadConfig fallback API style", () => {
  it.each([undefined, "", "   "])("inherits the provider style when the override is %j", (style) => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      AI_API_STYLE: "chat-completions",
      AI_FALLBACK_API_STYLE: style,
      AI_FALLBACK_MODELS: "backup-model",
    });

    expect(config.ai.fallback?.models[0]?.style).toBe("chat-completions");
  });

  it.each(["responses", "chat-completions", "google-native"])("preserves the explicit %s override", (style) => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      AI_FALLBACK_API_STYLE: style,
      AI_FALLBACK_MODELS: "backup-model",
    });

    expect(config.ai.fallback?.models[0]?.style).toBe(style);
  });

  it("rejects an invalid nonempty override", () => {
    expect(() => loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
      AI_FALLBACK_API_STYLE: "unsupported",
    })).toThrow("AI_FALLBACK_API_STYLE");
  });
});

describe("loadConfig admin roles", () => {
  it("separates Discord role IDs from case-insensitive exact names", () => {
    const config = loadConfig({
      AI_ADMIN_ROLES: "123456789012345678, Senior Admin,MOD TEAM",
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
    });

    expect([...config.adminRoles.ids]).toEqual(["123456789012345678"]);
    expect([...config.adminRoles.names]).toEqual(["senior admin", "mod team"]);
  });

  it("configures google-native provider with default Google Generative Language endpoint", () => {
    const config = loadConfig({
      AI_API_KEY: "test-google-key",
      AI_API_STYLE: "google-native",
      AI_MODEL: "gemma-4-31b-it",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.style).toBe("google-native");
    expect(config.ai.model).toBe("gemma-4-31b-it");
    expect(config.ai.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("allows custom baseUrl for google-native", () => {
    const config = loadConfig({
      AI_API_KEY: "test-google-key",
      AI_API_STYLE: "google-native",
      AI_BASE_URL: "https://my-proxy.example.com/v1beta",
      AI_MODEL: "gemini-2.5-flash",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.style).toBe("google-native");
    expect(config.ai.baseUrl).toBe("https://my-proxy.example.com/v1beta");
  });

  it("parses fallback models from comma-separated AI_FALLBACK_MODELS", () => {
    const config = loadConfig({
      AI_API_KEY: "google-key",
      AI_API_STYLE: "google-native",
      AI_FALLBACK_ENABLED: "true",
      AI_FALLBACK_MAX_RETRIES: "2",
      AI_FALLBACK_MODELS: "gemini-2.5-flash-lite,gemini-2.5-flash",
      AI_FALLBACK_TIMEOUT_MS: "15000",
      AI_MODEL: "gemma-4-31b-it",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.fallback?.enabled).toBe(true);
    expect(config.ai.fallback?.maxRetries).toBe(2);
    expect(config.ai.fallback?.timeoutMs).toBe(15_000);
    expect(config.ai.fallback?.models).toHaveLength(2);
    expect(config.ai.fallback?.models[0]?.model).toBe("gemini-2.5-flash-lite");
    expect(config.ai.fallback?.models[0]?.style).toBe("google-native");
    expect(config.ai.fallback?.models[0]?.apiKey).toBe("google-key");
    expect(config.ai.fallback?.models[1]?.model).toBe("gemini-2.5-flash");
    expect(config.ai.fallback?.models[1]?.style).toBe("google-native");
  });

  it("parses cross-provider fallback configurations using indexed env vars", () => {
    const config = loadConfig({
      AI_API_KEY: "google-key",
      AI_API_STYLE: "google-native",
      AI_FALLBACK_1_API_KEY: "google-key",
      AI_FALLBACK_1_MODEL: "gemini-2.5-flash-lite",
      AI_FALLBACK_2_API_KEY: "groq-key",
      AI_FALLBACK_2_API_STYLE: "chat-completions",
      AI_FALLBACK_2_BASE_URL: "https://api.groq.com/openai/v1",
      AI_FALLBACK_2_MODEL: "llama-3.3-70b-versatile",
      AI_FALLBACK_ENABLED: "true",
      AI_FALLBACK_MODELS: "gemini-2.5-flash-lite,llama-3.3-70b-versatile",
      AI_MODEL: "gemma-4-31b-it",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.fallback?.models).toHaveLength(2);
    expect(config.ai.fallback?.models[0]?.model).toBe("gemini-2.5-flash-lite");
    expect(config.ai.fallback?.models[0]?.style).toBe("google-native");
    expect(config.ai.fallback?.models[0]?.apiKey).toBe("google-key");

    expect(config.ai.fallback?.models[1]?.model).toBe("llama-3.3-70b-versatile");
    expect(config.ai.fallback?.models[1]?.style).toBe("chat-completions");
    expect(config.ai.fallback?.models[1]?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(config.ai.fallback?.models[1]?.apiKey).toBe("groq-key");
  });

  it("parses fallback models from AI_FALLBACK_CONFIG JSON array", () => {
    const config = loadConfig({
      AI_API_KEY: "default-key",
      AI_API_STYLE: "responses",
      AI_FALLBACK_CONFIG: JSON.stringify([
        { model: "gemini-2.5-flash-lite", style: "google-native" },
        {
          apiKey: "deepseek-key",
          baseUrl: "https://api.deepseek.com/v1",
          model: "deepseek-chat",
          style: "chat-completions",
        },
      ]),
      AI_FALLBACK_ENABLED: "true",
      AI_MODEL: "gpt-5-mini",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.fallback?.models).toHaveLength(2);
    expect(config.ai.fallback?.models[0]?.model).toBe("gemini-2.5-flash-lite");
    expect(config.ai.fallback?.models[0]?.style).toBe("google-native");
    expect(config.ai.fallback?.models[1]?.model).toBe("deepseek-chat");
    expect(config.ai.fallback?.models[1]?.apiKey).toBe("deepseek-key");
    expect(config.ai.fallback?.models[1]?.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("respects AI_FALLBACK_ENABLED=false", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      AI_FALLBACK_ENABLED: "false",
      AI_FALLBACK_MODELS: "gemini-2.5-flash-lite",
      AI_MODEL: "gemma-4-31b-it",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.fallback?.enabled).toBe(false);
  });

  it("loads conservative default retry and backoff settings", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.retry).toEqual({
      enabled: true,
      initialDelayMs: 1_000,
      maxAttempts: 3,
      maxDelayMs: 4_000,
      requestTimeoutMs: 15_000,
    });
  });

  it("loads custom retry and backoff settings from environment variables", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      AI_REQUEST_TIMEOUT_MS: "12000",
      AI_RETRY_ENABLED: "false",
      AI_RETRY_INITIAL_DELAY_MS: "500",
      AI_RETRY_MAX_ATTEMPTS: "4",
      AI_RETRY_MAX_DELAY_MS: "8000",
      DISCORD_TOKEN: "test-token",
    });

    expect(config.ai.retry).toEqual({
      enabled: false,
      initialDelayMs: 500,
      maxAttempts: 4,
      maxDelayMs: 8_000,
      requestTimeoutMs: 12_000,
    });
  });
});
