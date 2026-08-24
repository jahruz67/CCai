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
});
