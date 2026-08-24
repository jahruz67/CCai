import type { BotConfig } from "./config.js";
import {
  cleanCitationMarkers,
  formatDiscordMath,
  formatSourceList,
} from "./message-utils.js";
import type { SearchService } from "./search-provider.js";
import type { ChatMessage, ToolCall } from "./types.js";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface ProviderErrorBody {
  error?: {
    message?: unknown;
  };
  message?: unknown;
}

export class AiProviderError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiTimeoutError extends Error {
  public constructor() {
    super("The AI provider request timed out.");
    this.name = "AiTimeoutError";
  }
}

export class AiNetworkError extends Error {
  public constructor() {
    super("The AI provider could not be reached.");
    this.name = "AiNetworkError";
  }
}

export class AiRefusalError extends Error {
  public constructor() {
    super("The AI provider refused the request.");
    this.name = "AiRefusalError";
  }
}

export class AiIncompleteResponseError extends Error {
  public constructor(public readonly reason?: string) {
    super("The AI provider could not finish the response.");
    this.name = "AiIncompleteResponseError";
  }
}

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

export class AiClient {
  public constructor(
    private readonly config: BotConfig["ai"],
    private readonly fetcher: FetchLike = fetch,
    private readonly searchService?: SearchService,
  ) {}

  public async generate(
    messages: readonly ChatMessage[],
    externalSignal?: AbortSignal,
  ): Promise<string> {
    if (messages.length === 0 || !hasChatMessageContent(messages.at(-1)?.content)) {
      throw new Error("At least one non-empty chat message is required.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref?.();

    const abortFromCaller = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      if (this.config.style === "responses") {
        return await this.generateResponses(messages, controller.signal);
      }

      return await this.generateChatCompletions(messages, controller.signal);
    } catch (error) {
      if (
        error instanceof AiProviderError ||
        error instanceof AiRefusalError ||
        error instanceof AiIncompleteResponseError
      ) {
        throw error;
      }

      if (controller.signal.aborted) {
        if (externalSignal?.aborted) {
          throw error;
        }
        throw new AiTimeoutError();
      }

      throw new AiNetworkError();
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async generateResponses(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    const datedPrompt = `${this.config.systemPrompt}\nCurrent date: ${new Date()
      .toISOString()
      .slice(0, 10)}.`;

    const body: Record<string, unknown> = {
      input: messages.map((message) => ({
        content: formatResponsesContent(message.content),
        role: message.role,
      })),
      instructions: datedPrompt,
      max_output_tokens: this.config.maxOutputTokens,
      model: this.config.model,
    };

    if (this.config.reasoningEffort !== "off") {
      body.reasoning = { effort: this.config.reasoningEffort };
    }

    if (this.config.webSearchEnabled) {
      body.tools = [{ type: responsesWebSearchTool(this.config.baseUrl) }];
    }

    if (!isGroqBaseUrl(this.config.baseUrl)) {
      body.store = false;
    }

    const response = await this.fetcher(this.endpoint(), {
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

    const text = extractResponsesText(data);

    if (!text) {
      if (hasResponsesRefusal(data)) {
        throw new AiRefusalError();
      }

      const incompleteReason = extractIncompleteReason(data);
      if (incompleteReason) {
        throw new AiIncompleteResponseError(incompleteReason);
      }

      throw new AiProviderError(
        "AI provider returned an empty response.",
        response.status,
        requestId,
      );
    }

    return text;
  }

  private async generateChatCompletions(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
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

      if (this.config.webSearchEnabled) {
        if (isGroqBaseUrl(this.config.baseUrl)) {
          body.tools = [{ type: "browser_search" }];
        } else {
          body.tools = [WEB_SEARCH_TOOL_DEFINITION];
        }
      }

      const response = await this.fetcher(this.endpoint(), {
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
                toolContent = this.searchService.formatResultsForPrompt(results);
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

  private endpoint(): string {
    const path =
      this.config.style === "responses" ? "/responses" : "/chat/completions";
    return `${this.config.baseUrl}${path}`;
  }
}

function extractToolQuery(rawArgs: unknown): string {
  if (typeof rawArgs !== "string" || !rawArgs.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawArgs) as { q?: unknown; query?: unknown; search?: unknown };
    if (typeof parsed.query === "string") return parsed.query.trim();
    if (typeof parsed.q === "string") return parsed.q.trim();
    if (typeof parsed.search === "string") return parsed.search.trim();
  } catch {
    // If rawArgs is plain text
    return rawArgs.trim();
  }

  return "";
}

function responsesWebSearchTool(baseUrl: string): "browser_search" | "web_search" {
  return isGroqBaseUrl(baseUrl) ? "browser_search" : "web_search";
}

function isGroqBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.groq.com";
  } catch {
    return false;
  }
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

function parseJson(rawBody: string): unknown | undefined {
  if (!rawBody.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return undefined;
  }
}

function extractProviderError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const body = data as ProviderErrorBody;
  const possibleMessage = body.error?.message ?? body.message;
  return typeof possibleMessage === "string"
    ? possibleMessage.trim().slice(0, 240)
    : undefined;
}

export function extractResponsesText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const response = data as {
    output?: Array<{
      action?: { sources?: Array<{ url?: unknown }> };
      content?: Array<{
        annotations?: Array<{ type?: unknown; url?: unknown }>;
        text?: unknown;
        type?: unknown;
      }>;
      name?: unknown;
      output?: unknown;
    }>;
    output_text?: unknown;
  };

  const outputText = response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .join("\n")
    .trim();

  const rawText =
    outputText ||
    (typeof response.output_text === "string"
      ? response.output_text.trim()
      : "");
  if (!rawText) {
    return undefined;
  }

  const cleaned = cleanCitationMarkers(rawText);
  if (!cleaned) {
    return undefined;
  }

  const text = formatDiscordMath(cleaned).trim();
  if (!text) {
    return undefined;
  }

  const sourceUrls = extractResponseSourceUrls(response).filter(
    (url) => !text.includes(url),
  );
  const sourcesFormatted = formatSourceList(sourceUrls);
  if (!sourcesFormatted) {
    return text;
  }

  return `${text}\n\n${sourcesFormatted}`;
}

function extractResponseSourceUrls(response: {
  output?: Array<{
    action?: { sources?: Array<{ url?: unknown }> };
    content?: Array<{
      annotations?: Array<{ type?: unknown; url?: unknown }>;
    }>;
    name?: unknown;
    output?: unknown;
  }>;
}): string[] {
  const urls: string[] = [];

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation") {
          addHttpUrl(urls, annotation.url);
        }
      }
    }

    for (const source of item.action?.sources ?? []) {
      addHttpUrl(urls, source.url);
    }

    if (item.name === "browser.open" && typeof item.output === "string") {
      for (const match of item.output.matchAll(
        /^\s*L\d+:\s*URL:\s*(https?:\/\/\S+)\s*$/gim,
      )) {
        addHttpUrl(urls, match[1]);
      }
    }
  }

  return urls;
}

function addHttpUrl(urls: string[], candidate: unknown): void {
  if (typeof candidate !== "string") {
    return;
  }

  try {
    const url = new URL(candidate);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !urls.includes(url.href)
    ) {
      urls.push(url.href);
    }
  } catch {
    // Ignore malformed provider-supplied source URLs.
  }
}

function hasResponsesRefusal(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const response = data as {
    output?: Array<{
      content?: Array<{ refusal?: unknown; type?: unknown }>;
    }>;
  };
  return Boolean(
    response.output
      ?.flatMap((item) => item.content ?? [])
      .some(
        (content) =>
          content.type === "refusal" || typeof content.refusal === "string",
      ),
  );
}

function extractIncompleteReason(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const response = data as {
    incomplete_details?: { reason?: unknown };
    status?: unknown;
  };
  if (response.status !== "incomplete") {
    return undefined;
  }

  const reason = response.incomplete_details?.reason;
  return typeof reason === "string" ? reason.slice(0, 120) : "unknown";
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
    const cleaned = cleanCitationMarkers(content);
    const formatted = formatDiscordMath(cleaned).trim();
    return formatted || undefined;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const candidate = (part as { text?: unknown }).text;
        return typeof candidate === "string" ? candidate : "";
      })
      .join("\n");
    const cleaned = cleanCitationMarkers(text);
    const formatted = formatDiscordMath(cleaned).trim();
    return formatted || undefined;
  }

  return undefined;
}

export function hasChatMessageContent(
  content: ChatMessage["content"] | undefined,
): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (Array.isArray(content)) {
    return content.some((part) => {
      if (part.type === "text") {
        return part.text.trim().length > 0;
      }
      if (part.type === "image_url") {
        return Boolean(part.image_url?.url?.trim());
      }
      return false;
    });
  }
  return false;
}

export function formatResponsesContent(
  content: ChatMessage["content"],
): unknown {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text") {
        return { text: part.text, type: "input_text" };
      }
      if (part.type === "image_url") {
        return { image_url: part.image_url.url, type: "input_image" };
      }
      return part;
    });
  }
  return content;
}

