import type { BotConfig } from "../config.js";
import {
  cleanCitationMarkers,
  formatDiscordMath,
  formatSourceList,
  stripModelReasoning,
} from "../message-utils.js";
import type { SearchService } from "../search-provider.js";
import type { ChatMessage, GenerationOptions, ToolCall } from "../types.js";
import { AiProviderError } from "../ai-client.js";
import type { AiProvider, FetchLike } from "./types.js";
import {
  extractProviderError,
  parseJson,
} from "./responses-provider.js";

export const WEB_SEARCH_TOOL_DEFINITION = {
  function: {
    description:
      "Search the live web for up-to-date facts, breaking news, recent events, and authoritative documentation using DuckDuckGo/web search.",
    name: "web_search",
    parameters: {
      properties: {
        query: {
          description: "The search query to look up on the web.",
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
  },
  type: "function",
};

export class ChatCompletionsProvider implements AiProvider {
  public readonly style = "chat-completions" as const;

  public constructor(
    private readonly config: BotConfig["ai"],
    private readonly fetcher: FetchLike,
    private readonly searchService?: SearchService,
  ) {}

  public async generate(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: GenerationOptions,
  ): Promise<string> {
    const datedPrompt = `${this.config.systemPrompt}\nCurrent date: ${new Date()
      .toISOString()
      .slice(0, 10)}.`;

    const workingMessages: Array<Record<string, unknown>> = [
      { content: datedPrompt, role: "system" },
      ...messages.map((message) => ({
        content: message.content,
        role: message.role,
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
        ...(message.name ? { name: message.name } : {}),
      })),
    ];

    const tokenField = resolveChatTokenField(this.config);
    const citedUrls: string[] = [];
    const providedSearchResults = new Set<string>();
    const maxRounds = 4;

    for (let round = 0; round < maxRounds; round++) {
      const body: Record<string, unknown> = {
        [tokenField]: this.config.maxOutputTokens,
        messages: workingMessages,
        model: this.config.model,
      };

      if (this.config.reasoningEffort !== "off") {
        body.reasoning_effort = this.config.reasoningEffort;
      }

      if (this.config.webSearchEnabled && options?.webSearchEnabled !== false) {
        if (isGroqBaseUrl(this.config.baseUrl)) {
          body.tools = [{ type: "browser_search" }];
        } else {
          body.tools = [WEB_SEARCH_TOOL_DEFINITION];
        }
      }

      const endpoint = `${this.config.baseUrl}/chat/completions`;
      const response = await this.fetcher(endpoint, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      });

      const rawBody = await response.text();
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const data = parseJson(rawBody);

      if (!response.ok) {
        throw new AiProviderError(
          extractProviderError(data) ?? `AI provider returned HTTP ${response.status}.`,
          response.status,
          requestId,
        );
      }

      if (data === undefined) {
        throw new AiProviderError(
          "AI provider returned invalid JSON.",
          response.status,
          requestId,
        );
      }

      const choice = (data as {
        choices?: Array<{
          finish_reason?: string;
          message?: {
            content?: unknown;
            role?: string;
            tool_calls?: ToolCall[];
          };
        }>;
      }).choices?.[0];

      const toolCalls = choice?.message?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        workingMessages.push({
          content: choice?.message?.content ?? null,
          role: "assistant",
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          if (call.type === "function" && call.function) {
            const query = extractToolQuery(call.function.arguments);
            let toolContent = "No search results found.";

            if (this.searchService && query) {
              try {
                const results = await this.searchService.search(query, undefined, signal);
                for (const item of results) {
                  if (item.url && !citedUrls.includes(item.url)) {
                    citedUrls.push(item.url);
                  }
                }
                toolContent = this.searchService.formatResultsForPrompt(results, providedSearchResults);
              } catch {
                toolContent = "Web search was unable to reach search provider.";
              }
            }

            workingMessages.push({
              content: toolContent,
              role: "tool",
              tool_call_id: call.id,
            });
          }
        }
        continue;
      }

      const text = extractChatCompletionsText(data);
      if (!text) {
        throw new AiProviderError(
          "AI provider returned an empty response.",
          response.status,
          requestId,
        );
      }

      if (citedUrls.length > 0) {
        const uncited = citedUrls.filter((url) => !text.includes(url));
        const sourcesFormatted = formatSourceList(uncited);
        if (sourcesFormatted) {
          return `${text}\n\n${sourcesFormatted}`;
        }
      }

      return text;
    }

    throw new AiProviderError(
      "AI provider exceeded maximum tool calling rounds.",
      500,
    );
  }
}

function isGroqBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.groq.com";
  } catch {
    return false;
  }
}

export function extractToolQuery(rawArgs: unknown): string {
  if (typeof rawArgs !== "string" || !rawArgs.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawArgs) as { q?: unknown; query?: unknown; search?: unknown };
    if (typeof parsed.query === "string") return parsed.query.trim();
    if (typeof parsed.q === "string") return parsed.q.trim();
    if (typeof parsed.search === "string") return parsed.search.trim();
  } catch {
    return rawArgs.trim();
  }

  return "";
}

function resolveChatTokenField(
  config: BotConfig["ai"],
): "max_tokens" | "max_completion_tokens" {
  if (config.chatTokenField !== "auto") {
    return config.chatTokenField;
  }

  if (
    config.baseUrl.includes("api.openai.com") ||
    /^(?:o\d|gpt-5)/i.test(config.model)
  ) {
    return "max_completion_tokens";
  }

  return "max_tokens";
}

export function extractChatCompletionsText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const response = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    const cleaned = cleanCitationMarkers(stripModelReasoning(content));
    const formatted = formatDiscordMath(cleaned).trim();
    return formatted || undefined;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const block = part as { text?: unknown; thought?: unknown; type?: unknown };
        if (
          block.thought === true ||
          (block.type !== undefined && block.type !== "text" && block.type !== "output_text")
        ) {
          return "";
        }
        return typeof block.text === "string" ? block.text : "";
      })
      .join("\n");
    const cleaned = cleanCitationMarkers(stripModelReasoning(text));
    const formatted = formatDiscordMath(cleaned).trim();
    return formatted || undefined;
  }

  return undefined;
}
