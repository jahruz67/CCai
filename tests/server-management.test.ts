import { describe, expect, it } from "vitest";
import {
  parseManageCommand,
  parseManagementPlan,
} from "../src/server-management.js";

describe("parseManageCommand", () => {
  it("parses requests and confirmation controls", () => {
    expect(parseManageCommand("manage create a channel named news")).toEqual({
      kind: "request",
      request: "create a channel named news",
    });
    expect(parseManageCommand("MANAGE confirm")).toEqual({ kind: "confirm" });
    expect(parseManageCommand("manage cancel")).toEqual({ kind: "cancel" });
  });

  it("does not intercept ordinary chat", () => {
    expect(parseManageCommand("how do I manage channels?")).toBeUndefined();
  });
});

describe("parseManagementPlan", () => {
  it("accepts a fenced, valid plan", () => {
    expect(
      parseManagementPlan(
        '```json\n{"summary":"Create news","actions":[{"type":"create_channel","name":"news","channelType":"text"}]}\n```',
      ),
    ).toEqual({
      actions: [{ channelType: "text", name: "news", type: "create_channel" }],
      summary: "Create news",
    });
  });

  it("rejects unknown actions and unsafe numeric ranges", () => {
    expect(() =>
      parseManagementPlan(
        '{"summary":"Bad","actions":[{"type":"delete_everything"}]}',
      ),
    ).toThrow("invalid management plan");
    expect(() =>
      parseManagementPlan(
        '{"summary":"Too many","actions":[{"type":"purge_messages","count":101}]}',
      ),
    ).toThrow("invalid management plan");
  });
});
