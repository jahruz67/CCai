import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

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
});
