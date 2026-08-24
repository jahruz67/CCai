import { describe, expect, it } from "vitest";
import { parsePrompt } from "../src/prompt-parser.js";

const baseInput = {
  botUserId: "123",
  content: "",
  isDirectMessage: false,
  isReplyToBot: false,
  prefix: "cc",
};

describe("parsePrompt", () => {
  it("parses a case-insensitive prefix as a whole word", () => {
    expect(parsePrompt({ ...baseInput, content: "CC what is 1+1" })).toEqual({
      source: "prefix",
      text: "what is 1+1",
    });
    expect(parsePrompt({ ...baseInput, content: "bbq ribs" })).toBeUndefined();
  });

  it("returns an empty prompt for the prefix alone", () => {
    expect(parsePrompt({ ...baseInput, content: "  cc  " })).toEqual({
      source: "prefix",
      text: "",
    });
  });

  it("accepts punctuation delimiters after the prefix", () => {
    expect(parsePrompt({ ...baseInput, content: "cc, what?" })).toEqual({
      source: "prefix",
      text: "what?",
    });
    expect(parsePrompt({ ...baseInput, content: "cc: help" })).toEqual({
      source: "prefix",
      text: "help",
    });
    expect(parsePrompt({ ...baseInput, content: "cc-question" })).toEqual({
      source: "prefix",
      text: "question",
    });
  });

  it("parses both Discord mention formats", () => {
    expect(parsePrompt({ ...baseInput, content: "<@123> hello" })).toEqual({
      source: "mention",
      text: "hello",
    });
    expect(parsePrompt({ ...baseInput, content: "<@!123>, hello" })).toEqual({
      source: "mention",
      text: "hello",
    });
    expect(parsePrompt({ ...baseInput, content: "<@999> hello" })).toBeUndefined();
  });

  it("accepts replies and direct messages without a prefix", () => {
    expect(
      parsePrompt({ ...baseInput, content: "follow up", isReplyToBot: true }),
    ).toEqual({ source: "reply", text: "follow up" });
    expect(
      parsePrompt({ ...baseInput, content: "hello", isDirectMessage: true }),
    ).toEqual({ source: "dm", text: "hello" });
  });

  it("ignores empty and unrelated guild messages", () => {
    expect(parsePrompt({ ...baseInput, content: "   " })).toBeUndefined();
    expect(parsePrompt({ ...baseInput, content: "hello everyone" })).toBeUndefined();
  });

  it("handles empty content with attachments in DMs and replies", () => {
    expect(
      parsePrompt({
        ...baseInput,
        content: "",
        hasAttachments: true,
        isDirectMessage: true,
      }),
    ).toEqual({ source: "dm", text: "" });

    expect(
      parsePrompt({
        ...baseInput,
        content: "",
        hasAttachments: true,
        isReplyToBot: true,
      }),
    ).toEqual({ source: "reply", text: "" });

    expect(
      parsePrompt({
        ...baseInput,
        content: "",
        hasAttachments: true,
        isDirectMessage: false,
        isReplyToBot: false,
      }),
    ).toBeUndefined();
  });
});
