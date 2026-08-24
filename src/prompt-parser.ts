export type PromptSource = "dm" | "mention" | "prefix" | "reply";

export interface ParsedPrompt {
  source: PromptSource;
  text: string;
}

export interface PromptInput {
  botUserId: string;
  content: string;
  hasAttachments?: boolean;
  isDirectMessage: boolean;
  isReplyToBot: boolean;
  prefix: string;
}

export function parsePrompt(input: PromptInput): ParsedPrompt | undefined {
  const content = input.content.trim();
  if (!content) {
    if (input.hasAttachments) {
      if (input.isReplyToBot) {
        return { source: "reply", text: "" };
      }
      if (input.isDirectMessage) {
        return { source: "dm", text: "" };
      }
    }
    return undefined;
  }


  const prefixPattern = new RegExp(
    `^${escapeRegex(input.prefix)}(?=$|[\\s,:-])[\\s,:-]*`,
    "i",
  );
  if (prefixPattern.test(content)) {
    return {
      source: "prefix",
      text: content.replace(prefixPattern, "").trim(),
    };
  }

  const mentionPattern = new RegExp(
    `^<@!?${escapeRegex(input.botUserId)}>[\\s,:-]*`,
  );
  if (mentionPattern.test(content)) {
    return {
      source: "mention",
      text: content.replace(mentionPattern, "").trim(),
    };
  }

  if (input.isReplyToBot) {
    return { source: "reply", text: content };
  }

  if (input.isDirectMessage) {
    return { source: "dm", text: content };
  }

  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
