import { describe, expect, it } from "vitest";
import { ConversationStore } from "../src/conversation-store.js";

describe("ConversationStore", () => {
  it("stores complete turns and isolates scopes", () => {
    const store = new ConversationStore({
      maxContextChars: 1_000,
      maxTurns: 3,
      ttlMs: 100,
    });
    store.appendTurn("a", "hello", "hi");

    expect(store.getMessages("a")).toEqual([
      { content: "hello", role: "user" },
      { content: "hi", role: "assistant" },
    ]);
    expect(store.getMessages("b")).toEqual([]);
  });

  it("expires at the TTL boundary without reads extending the TTL", () => {
    let now = 1_000;
    const store = new ConversationStore({
      maxContextChars: 1_000,
      maxTurns: 3,
      now: () => now,
      ttlMs: 100,
    });
    store.appendTurn("a", "hello", "hi");
    now = 1_099;
    expect(store.getMessages("a")).toHaveLength(2);
    now = 1_100;
    expect(store.getMessages("a")).toEqual([]);
  });

  it("evicts the oldest complete turns", () => {
    const store = new ConversationStore({
      maxContextChars: 1_000,
      maxTurns: 2,
      ttlMs: 100,
    });
    store.appendTurn("a", "one", "1");
    store.appendTurn("a", "two", "2");
    store.appendTurn("a", "three", "3");

    expect(store.getMessages("a").map((message) => message.content)).toEqual([
      "two",
      "2",
      "three",
      "3",
    ]);
  });

  it("honors a disabled history setting", () => {
    const store = new ConversationStore({
      maxContextChars: 1_000,
      maxTurns: 0,
      ttlMs: 100,
    });
    store.appendTurn("a", "hello", "hi");
    expect(store.getMessages("a")).toEqual([]);

    const storeExplicitDisabled = new ConversationStore({
      enabled: false,
      maxContextChars: 1_000,
      maxTurns: 5,
      ttlMs: 100,
    });
    storeExplicitDisabled.appendTurn("a", "hello", "hi");
    expect(storeExplicitDisabled.getMessages("a")).toEqual([]);
  });

  it("limits history by maxChars budget and evicts oldest turns", () => {
    const store = new ConversationStore({
      maxChars: 15,
      ttlMs: 100,
    });
    store.appendTurn("a", "12345", "12345"); // 10 chars
    store.appendTurn("a", "abcde", "abcde"); // 10 chars (total 20 > 15)

    // Oldest turn should be evicted to fit within 15 chars
    expect(store.getMessages("a").map((m) => m.content)).toEqual([
      "abcde",
      "abcde",
    ]);
  });

  it("clears only the requested scope", () => {
    const store = new ConversationStore({
      maxContextChars: 1_000,
      maxTurns: 3,
      ttlMs: 100,
    });
    store.appendTurn("a", "hello", "hi");
    store.appendTurn("b", "hello", "hi");
    expect(store.clear("a")).toBe(true);
    expect(store.getMessages("a")).toEqual([]);
    expect(store.getMessages("b")).toHaveLength(2);
  });
});
