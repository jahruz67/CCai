import type { BotConfig } from "./config.js";
import type { SearchService } from "./search-provider.js";
import type { ChatMessage } from "./types.js";
import type { AiProvider, FetchLike } from "./providers/types.js";
import { createAiProvider } from "./providers/factory.js";
import {
  extractResponsesText,
  formatResponsesContent,
} from "./providers/responses-provider.js";
import {
  extractChatCompletionsText,
  WEB_SEARCH_TOOL_DEFINITION,
} from "./providers/chat-completions-provider.js";
import {
  extractGoogleNativeText,
  GEMINI_WEB_SEARCH_TOOL,
  isGemmaModel,
} from "./providers/google-native-provider.js";

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

export {
  extractChatCompletionsText,
  extractGoogleNativeText,
  extractResponsesText,
  formatResponsesContent,
  GEMINI_WEB_SEARCH_TOOL,
  isGemmaModel,
  WEB_SEARCH_TOOL_DEFINITION,
};

export class AiClient {
  private readonly provider: AiProvider;

  public constructor(
    private readonly config: BotConfig["ai"],
    private readonly fetcher: FetchLike = fetch,
    private readonly searchService?: SearchService,
  ) {
    this.provider = createAiProvider(this.config, this.fetcher, this.searchService);
  }

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
      return await this.provider.generate(messages, controller.signal);
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
