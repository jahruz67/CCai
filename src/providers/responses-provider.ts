import type { BotConfig } from "../config.js";
import {
  cleanCitationMarkers,
  formatDiscordMath,
  formatSourceList,
  stripModelReasoning,
} from "../message-utils.js";
import type { SearchService } from "../search-provider.js";
import type { ChatMessage, GenerationOptions } from "../types.js";
import {
  AiIncompleteResponseError,
  AiProviderError,
  AiRefusalError,
} from "../ai-client.js";
import type { AiProvider, FetchLike } from "./types.js";

export class ResponsesProvider implements AiProvider {
  public readonly style = "responses" as const;

  public constructor(
    private readonly config: BotConfig["ai"],
    private readonly fetcher: FetchLike,
    private readonly _searchService?: SearchService,
  ) {}

  public async generate(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: GenerationOptions,
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

    if (this.config.webSearchEnabled && options?.webSearchEnabled !== false) {
      body.tools = [{ type: responsesWebSearchTool(this.config.baseUrl) }];
    }

    if (!isGroqBaseUrl(this.config.baseUrl)) {
      body.store = false;
    }

    const endpoint = `${this.config.baseUrl}/responses`;
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

export function parseJson(rawBody: string): unknown | undefined {
  if (!rawBody.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return undefined;
  }
}

interface ProviderErrorBody {
  error?: {
    message?: unknown;
  };
  message?: unknown;
}

export function extractProviderError(data: unknown): string | undefined {
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
      channel?: unknown;
      content?: Array<{
        annotations?: Array<{ type?: unknown; url?: unknown }>;
        text?: unknown;
        type?: unknown;
      }>;
      name?: unknown;
      output?: unknown;
      type?: unknown;
    }>;
    output_text?: unknown;
  };

  const outputText = response.output
    ?.filter((item) => item.type !== "reasoning" && item.channel !== "analysis")
    .flatMap((item) => item.content ?? [])
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

  const cleaned = cleanCitationMarkers(stripModelReasoning(rawText));
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

export function extractResponseSourceUrls(response: {
  output?: Array<{
    action?: { sources?: Array<{ url?: unknown }> };
    channel?: unknown;
    content?: Array<{
      annotations?: Array<{ type?: unknown; url?: unknown }>;
    }>;
    name?: unknown;
    output?: unknown;
    type?: unknown;
  }>;
}): string[] {
  const urls: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type === "reasoning" || item.channel === "analysis") {
      continue;
    }
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

export function addHttpUrl(urls: string[], candidate: unknown): void {
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
