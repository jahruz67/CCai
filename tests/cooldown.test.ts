import { describe, expect, it } from "vitest";
import { Cooldown } from "../src/cooldown.js";

describe("Cooldown", () => {
  it("allows the first request, blocks until expiry, and isolates keys", () => {
    let now = 1_000;
    const cooldown = new Cooldown(3_000, () => now);
    expect(cooldown.consume("a")).toBe(0);
    expect(cooldown.consume("a")).toBe(3_000);
    expect(cooldown.consume("b")).toBe(0);
    now = 3_999;
    expect(cooldown.consume("a")).toBe(1);
    now = 4_000;
    expect(cooldown.consume("a")).toBe(0);
  });

  it("can be disabled", () => {
    const cooldown = new Cooldown(0);
    expect(cooldown.consume("a")).toBe(0);
    expect(cooldown.consume("a")).toBe(0);
  });
});
