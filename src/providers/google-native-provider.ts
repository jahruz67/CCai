import type { BotConfig } from "../config.js";
import {
  cleanCitationMarkers,
  formatDiscordMath,
  formatSourceList,
  stripModelReasoning,
} from "../message-utils.js";
import type { SearchService } from "../search-provider.js";
import type { ChatMessage, GenerationOptions, ToolCall } from "../types.js";
import {
  AiIncompleteResponseError,
  AiProviderError,
  AiRefusalError,
} from "../ai-client.js";
import type { AiProvider, FetchLike } from "./types.js";
import {
  addHttpUrl,
  parseJson,
} from "./responses-provider.js";
import {
  DEFAULT_AI_RETRY_CONFIG,
  executeFetchWithRetry,
  extractGoogleError,
  type AiRetryConfig,
  type RetryLogger,
} from "../retry-strategy.js";

export interface GoogleNativeProviderOptions {
  jitterFn?: () => number;
  logger?: RetryLogger;
  retryOptions?: Partial<AiRetryConfig>;
}

export function isGemmaModel(model: string): boolean {
  return /gemma/i.test(model);
}

export interface GooglePart {
  functionCall?: {
    args?: Record<string, unknown>;
    name: string;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
  inlineData?: {
    data: string;
    mimeType: string;
  };
  text?: string;
}

export interface GoogleContent {
  parts: GooglePart[];
  role: "user" | "model";
}

export const GEMINI_WEB_SEARCH_TOOL = {
  functionDeclarations: [
    {
      description:
        "Search the live web for up-to-date facts, breaking news, recent events, and authoritative documentation using DuckDuckGo/web search.",
      name: "web_search",
      parameters: {
        properties: {
          query: {
            description: "The search query to look up on the web.",
            type: "STRING",
          },
        },
        required: ["query"],
        type: "OBJECT",
      },
    },
  ],
};

export class GoogleNativeProvider implements AiProvider {
  public readonly style = "google-native" as const;

  public constructor(
    private readonly config: BotConfig["ai"],
    private readonly fetcher: FetchLike,
    private readonly searchService?: SearchService,
    private readonly options: GoogleNativeProviderOptions = {},
  ) {}

  private getRetryConfig(): AiRetryConfig {
    return {
      ...DEFAULT_AI_RETRY_CONFIG,
      ...this.config.retry,
      ...this.options.retryOptions,
    };
  }

  public async generate(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: GenerationOptions,
  ): Promise<string> {
    const isGemma = isGemmaModel(this.config.model);
    const datedPrompt = `${this.config.systemPrompt}\nCurrent date: ${new Date()
      .toISOString()
      .slice(0, 10)}.`;

    // Gemma models do not support systemInstruction or function calling in Google API.
    // When using Gemma, system instructions are prepended to the first user message,
    // and tools are omitted (proactive search in AssistantService already covers live web data).
    let useSystemInstruction = !isGemma;
    let useTools = !isGemma && this.config.webSearchEnabled &&
      options?.webSearchEnabled !== false && Boolean(this.searchService);

    return this.executeWithFallbacks(
      messages,
      datedPrompt,
      useSystemInstruction,
      useTools,
      signal,
    );
  }

  private async executeWithFallbacks(
    messages: readonly ChatMessage[],
    datedPrompt: string,
    useSystemInstruction: boolean,
    useTools: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      return await this.executeGenerate(
        messages,
        datedPrompt,
        useSystemInstruction,
        useTools,
        signal,
      );
    } catch (error) {
      if (error instanceof AiProviderError && error.status === 400) {
        // Request-format compatibility 1: If model rejected top-level system_instruction (HTTP 400),
        // retry with system instructions safely prepended to the user turn so instructions & safety rules are preserved.
        if (useSystemInstruction && /system[_ ]instruction/i.test(error.message)) {
          return this.executeWithFallbacks(
            messages,
            datedPrompt,
            false,
            useTools,
            signal,
          );
        }

        // Request-format compatibility 2: If model rejected function calling / tools declarations (HTTP 400),
        // retry without tool declarations. Note: Proactive web search in AssistantService already covers live
        // web context, and Discord server permissions are enforced independently in Node.js by ServerManager.
        if (useTools && /(?:function|tool|call)/i.test(error.message)) {
          return this.executeWithFallbacks(
            messages,
            datedPrompt,
            useSystemInstruction,
            false,
            signal,
          );
        }
      }

      throw error;
    }
  }

  private async executeGenerate(
    messages: readonly ChatMessage[],
    datedPrompt: string,
    useSystemInstruction: boolean,
    useTools: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    const isGemma = isGemmaModel(this.config.model);
    const workingContents = this.buildGoogleContents(
      messages,
      useSystemInstruction ? undefined : datedPrompt,
      isGemma,
    );

    const citedUrls: string[] = [];
    const providedSearchResults = new Set<string>();
    const maxRounds = 4;
    const cleanModel = this.config.model.replace(/^models\//, "");
    const endpoint = `${this.config.baseUrl}/models/${cleanModel}:generateContent`;

    for (let round = 0; round < maxRounds; round++) {
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: this.config.maxOutputTokens,
      };

      if (this.config.reasoningEffort !== "off" && !isGemma) {
        const budgetMap: Record<string, number> = {
          high: 8192,
          low: 1024,
          medium: 4096,
          none: 0,
        };
        const budget = budgetMap[this.config.reasoningEffort];
        if (budget !== undefined) {
          generationConfig.thinkingConfig = { thinkingBudget: budget };
        }
      }

      const body: Record<string, unknown> = {
        contents: workingContents,
        generationConfig,
      };

      if (useSystemInstruction) {
        body.systemInstruction = {
          parts: [{ text: datedPrompt }],
        };
      }

      if (useTools) {
        body.tools = [GEMINI_WEB_SEARCH_TOOL];
      }

      const fetchCall = (callSignal: AbortSignal) =>
        this.fetcher(endpoint, {
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.config.apiKey,
          },
          method: "POST",
          signal: callSignal,
        });

      const { data, requestId, response } = await executeFetchWithRetry(
        fetchCall,
        {
          jitterFn: this.options.jitterFn,
          logger: this.options.logger,
          model: cleanModel,
          parentSignal: signal,
          retryConfig: this.getRetryConfig(),
        },
      );

      if (data === undefined) {
        throw new AiProviderError(
          "AI provider returned invalid JSON.",
          response.status,
          requestId,
        );
      }

      const parsedData = data as {
        candidates?: Array<{
          content?: {
            parts?: GooglePart[];
            role?: string;
          };
          finishReason?: string;
          groundingMetadata?: {
            groundingChunks?: Array<{
              web?: {
                title?: string;
                uri?: string;
              };
            }>;
            webSearchQueries?: string[];
          };
        }>;
        promptFeedback?: {
          blockReason?: string;
        };
      };

      if (parsedData.promptFeedback?.blockReason) {
        throw new AiRefusalError();
      }

      const candidate = parsedData.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      // Extract Grounding / Web search sources if returned by Google
      if (candidate?.groundingMetadata?.groundingChunks) {
        for (const chunk of candidate.groundingMetadata.groundingChunks) {
          if (chunk.web?.uri) {
            addHttpUrl(citedUrls, chunk.web.uri);
          }
        }
      }

      // Check for function calling
      const functionCallPart = parts.find((p) => Boolean(p.functionCall));
      if (functionCallPart?.functionCall && useTools) {
        const call = functionCallPart.functionCall;
        workingContents.push({
          parts: [functionCallPart],
          role: "model",
        });

        let toolContent = "No search results found.";
        const query =
          typeof call.args?.query === "string"
            ? call.args.query.trim()
            : typeof call.args?.q === "string"
              ? (call.args.q as string).trim()
              : "";

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

        workingContents.push({
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: { content: toolContent },
              },
            },
          ],
          role: "user",
        });

        continue;
      }

      const text = extractGoogleNativeText(data);
      if (!text) {
        const finishReason = candidate?.finishReason;
        if (
          finishReason === "SAFETY" ||
          finishReason === "RECITATION" ||
          finishReason === "BLOCKLIST" ||
          finishReason === "PROHIBITED_CONTENT" ||
          finishReason === "SPII"
        ) {
          throw new AiRefusalError();
        }

        if (finishReason === "MAX_TOKENS") {
          throw new AiIncompleteResponseError("max_output_tokens");
        }

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

  private buildGoogleContents(
    messages: readonly ChatMessage[],
    systemInstructionPrefix?: string,
    isGemma = false,
  ): GoogleContent[] {
    const rawTurns: GoogleContent[] = [];

    let hasPrependedSystem = false;

    for (const message of messages) {
      if (message.role === "system") {
        continue;
      }

      if (message.role === "assistant") {
        const parts: GooglePart[] = [];
        if (typeof message.content === "string" && message.content.trim()) {
          parts.push({ text: message.content });
        }
        if (message.tool_calls) {
          for (const call of message.tool_calls) {
            parts.push({
              functionCall: {
                args: (parseJson(call.function.arguments) as Record<string, unknown>) ?? {},
                name: call.function.name,
              },
            });
          }
        }
        if (parts.length > 0) {
          rawTurns.push({ parts, role: "model" });
        }
        continue;
      }

      if (message.role === "tool") {
        const contentStr =
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);
        rawTurns.push({
          parts: [
            {
              functionResponse: {
                name: message.name || "web_search",
                response: { content: contentStr },
              },
            },
          ],
          role: "user",
        });
        continue;
      }

      // role: "user"
      const parts: GooglePart[] = [];
      let textContent = "";

      if (typeof message.content === "string") {
        textContent = message.content;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "text") {
            textContent += (textContent ? "\n" : "") + part.text;
          } else if (part.type === "image_url") {
            const url = part.image_url.url;
            if (isGemma) {
              textContent += "\n[Attached image - not supported by text-only Gemma model]";
            } else if (url.startsWith("data:")) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/s);
              if (match && match[1] && match[2]) {
                parts.push({
                  inlineData: {
                    data: match[2],
                    mimeType: match[1],
                  },
                });
              }
            } else {
              textContent += `\n[Image URL: ${url}]`;
            }
          }
        }
      }

      if (systemInstructionPrefix && !hasPrependedSystem) {
        textContent = `[System Instructions]\n${systemInstructionPrefix}\n\n${textContent}`;
        hasPrependedSystem = true;
      }

      if (textContent) {
        parts.unshift({ text: textContent });
      }

      if (parts.length > 0) {
        rawTurns.push({ parts, role: "user" });
      }
    }

    // If system prefix was requested but never added (e.g. no user turns), add as user turn
    if (systemInstructionPrefix && !hasPrependedSystem) {
      rawTurns.unshift({
        parts: [{ text: `[System Instructions]\n${systemInstructionPrefix}` }],
        role: "user",
      });
    }

    // Google Generative Language API requires alternating user/model turns starting with user
    return coalesceTurns(rawTurns);
  }
}

function coalesceTurns(turns: GoogleContent[]): GoogleContent[] {
  const coalesced: GoogleContent[] = [];

  for (const turn of turns) {
    if (turn.parts.length === 0) {
      continue;
    }

    const last = coalesced.at(-1);
    if (last && last.role === turn.role) {
      last.parts.push(...turn.parts);
    } else {
      coalesced.push({
        parts: [...turn.parts],
        role: turn.role,
      });
    }
  }

  // Google API requires the first turn to have role: "user"
  if (coalesced.length > 0 && coalesced[0]?.role === "model") {
    coalesced.shift();
  }

  return coalesced;
}


export function extractGoogleNativeText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const response = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: unknown;
          thought?: unknown;
        }>;
      };
    }>;
  };

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const rawText = parts
    .filter((part) => part.thought !== true)
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();

  if (!rawText) {
    return undefined;
  }

  const cleaned = cleanCitationMarkers(stripModelReasoning(rawText));
  if (!cleaned) {
    return undefined;
  }

  const formatted = formatDiscordMath(cleaned).trim();
  return formatted || undefined;
}
