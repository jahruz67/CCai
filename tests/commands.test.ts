import { describe, expect, it } from "vitest";
import {
  helpText,
  parseBuiltInCommand,
  parseForgetCommand,
  parseMemoryCommand,
  parseRememberCommand,
  parseSearchCommand,
  slashCommands,
} from "../src/commands.js";

describe("parseBuiltInCommand", () => {
  it("recognizes exact built-in commands and reset alias", () => {
    expect(parseBuiltInCommand(" HELP ")).toBe("help");
    expect(parseBuiltInCommand("clear")).toBe("clear");
    expect(parseBuiltInCommand("reset")).toBe("clear");
    expect(parseBuiltInCommand("ping")).toBe("ping");
  });

  it("does not swallow normal questions", () => {
    expect(parseBuiltInCommand("help me understand this")).toBeUndefined();
    expect(parseBuiltInCommand("what is ping?")).toBeUndefined();
  });
});

describe("parseSearchCommand", () => {
  it("extracts search query from prefix message", () => {
    expect(parseSearchCommand("search latest news")).toBe("latest news");
    expect(parseSearchCommand("SEARCH deep learning 2026")).toBe("deep learning 2026");
    expect(parseSearchCommand("search")).toBe("");
    expect(parseSearchCommand("searching for items")).toBeUndefined();
    expect(parseSearchCommand("what is a search engine?")).toBeUndefined();
  });
});

describe("parseRememberCommand", () => {
  it("parses equality, colon, arrow, and 'is' delimiters", () => {
    expect(parseRememberCommand("remember BRB = Be Right Back")).toEqual({
      isServerScope: false,
      key: "BRB",
      value: "Be Right Back",
    });

    expect(parseRememberCommand("remember timezone : UTC+2")).toEqual({
      isServerScope: false,
      key: "timezone",
      value: "UTC+2",
    });

    expect(parseRememberCommand("remember WFH -> Working From Home")).toEqual({
      isServerScope: false,
      key: "WFH",
      value: "Working From Home",
    });

    expect(parseRememberCommand("remember my favorite language is TypeScript")).toEqual({
      isServerScope: false,
      key: "my favorite language",
      value: "TypeScript",
    });
  });

  it("parses abbreviation and abbrev prefixes", () => {
    expect(parseRememberCommand("remember abbreviation GPU = Graphics Processing Unit")).toEqual({
      isServerScope: false,
      key: "GPU",
      value: "Graphics Processing Unit",
    });

    expect(parseRememberCommand("remember abbrev AFK : Away From Keyboard")).toEqual({
      isServerScope: false,
      key: "AFK",
      value: "Away From Keyboard",
    });
  });

  it("parses server scope tags", () => {
    expect(parseRememberCommand("remember [server] rule 1 = Be kind")).toEqual({
      isServerScope: true,
      key: "rule 1",
      value: "Be kind",
    });

    expect(parseRememberCommand("remember server: meeting = Mondays at 10am")).toEqual({
      isServerScope: true,
      key: "meeting",
      value: "Mondays at 10am",
    });
  });

  it("parses space-separated key and value fallback", () => {
    expect(parseRememberCommand("remember BRB BeRightBack")).toEqual({
      isServerScope: false,
      key: "BRB",
      value: "BeRightBack",
    });
  });

  it("returns undefined for empty remember command", () => {
    expect(parseRememberCommand("remember")).toBeUndefined();
  });
});

describe("parseForgetCommand", () => {
  it("parses specific keys and 'all'", () => {
    expect(parseForgetCommand("forget BRB")).toEqual({
      isAll: false,
      isServerScope: false,
      key: "BRB",
    });

    expect(parseForgetCommand("forget all")).toEqual({
      isAll: true,
      isServerScope: false,
      key: "all",
    });

    expect(parseForgetCommand("forget [server] meeting")).toEqual({
      isAll: false,
      isServerScope: true,
      key: "meeting",
    });

    expect(parseForgetCommand("forget server all")).toEqual({
      isAll: true,
      isServerScope: true,
      key: "all",
    });
  });

  it("returns undefined when no key is specified", () => {
    expect(parseForgetCommand("forget")).toBeUndefined();
  });
});

describe("parseMemoryCommand", () => {
  it("parses memory list commands and scope filters", () => {
    expect(parseMemoryCommand("memory")).toEqual({ scope: "all" });
    expect(parseMemoryCommand("memories")).toEqual({ scope: "all" });
    expect(parseMemoryCommand("memory list")).toEqual({ scope: "all" });
    expect(parseMemoryCommand("memory personal")).toEqual({ scope: "personal" });
    expect(parseMemoryCommand("memory server")).toEqual({ scope: "server" });
  });

  it("returns undefined for non-matching commands", () => {
    expect(parseMemoryCommand("memorize this")).toBeUndefined();
  });
});

describe("slashCommands & helpText", () => {
  it("includes chat, memory, search, and server-management commands", () => {
    const names = slashCommands.map((cmd) => cmd.name);
    expect(names).toContain("ask");
    expect(names).toContain("search");
    expect(names).toContain("remember");
    expect(names).toContain("forget");
    expect(names).toContain("memory");
    expect(names).toContain("manage");
    expect(names).toContain("help");

    const rememberCmd = slashCommands.find((cmd) => cmd.name === "remember");
    const rememberOptions = rememberCmd?.options?.map((opt: { name: string }) => opt.name);
    expect(rememberOptions).toContain("key");
    expect(rememberOptions).toContain("value");
    expect(rememberOptions).toContain("scope");
  });

  it("mentions search, remember, and images in helpText", () => {
    const help = helpText("cc");
    expect(help).toContain("cc search");
    expect(help).toContain("cc remember");
    expect(help).toContain("cc memory");
    expect(help).toContain("cc forget");
    expect(help).toContain("cc manage");
    expect(help).toContain("DuckDuckGo");
  });
});
