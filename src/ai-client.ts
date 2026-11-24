import type { BotConfig } from "./config.js";
import type { SearchService } from "./search-provider.js";
import type { ChatMessage, GenerationOptions } from "./types.js";
import type { AiProvider, AiProviderOptions, FetchLike } from "./providers/types.js";
export type { AiProviderOptions } from "./providers/types.js";
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
  type GoogleNativeProviderOptions,
} from "./providers/google-native-provider.js";
import {
  type AiRetryConfig,
  computeBackoffDelay,
  DEFAULT_AI_RETRY_CONFIG,
  extractServerRetryDelay,
  isTransientGoogleError,
  isTransientProviderError,
} from "./retry-strategy.js";
import {
  AiAllModelsFailedError,
  AiIncompleteResponseError,
  AiNetworkError,
  AiProviderError,
  AiRefusalError,
  AiTimeoutError,
} from "./ai-errors.js";
export {
  AiAllModelsFailedError,
  AiIncompleteResponseError,
  AiNetworkError,
  AiProviderError,
  AiRefusalError,
  AiTimeoutError,
  type AiRetryConfig,
  computeBackoffDelay,
  DEFAULT_AI_RETRY_CONFIG,
  extractServerRetryDelay,
  isTransientGoogleError,
  isTransientProviderError,
  type GoogleNativeProviderOptions,
};
import {
  FallbackOrchestrator,
  type FallbackOrchestratorOptions,
} from "./fallback-orchestrator.js";
export {
  canFallbackToCandidate,
  CircuitBreaker,
  classifyError,
  FallbackOrchestrator,
  resolveCandidates,
  sleep,
} from "./fallback-orchestrator.js";

export {
  extractChatCompletionsText,
  extractGoogleNativeText,
  extractResponsesText,
  formatResponsesContent,
  GEMINI_WEB_SEARCH_TOOL,
  isGemmaModel,
  WEB_SEARCH_TOOL_DEFINITION,
};

export interface AiClientOptions {
  fallbackOptions?: FallbackOrchestratorOptions;
  providerOptions?: AiProviderOptions;
  /** @deprecated Use providerOptions. */
  googleOptions?: GoogleNativeProviderOptions;
}

export class AiClient {
  private readonly fallback: FallbackOrchestrator | null;
  private readonly provider: AiProvider;

  public constructor(
    private readonly config: BotConfig["ai"],
    private readonly fetcher: FetchLike = fetch,
    private readonly searchService?: SearchService,
    options?: FallbackOrchestratorOptions | AiClientOptions,
  ) {
    const fallbackOptions = options && "fallbackOptions" in options
      ? options.fallbackOptions
      : options as FallbackOrchestratorOptions | undefined;
    const providerOptions = options?.providerOptions ?? fallbackOptions?.providerOptions
      ?? options?.googleOptions ?? fallbackOptions?.googleOptions;

    this.provider = createAiProvider(
      this.config,
      this.fetcher,
      this.searchService,
      providerOptions,
    );

    const fbConfig = this.config.fallback;
    if (fbConfig && fbConfig.enabled && fbConfig.models.length > 0) {
      this.fallback = new FallbackOrchestrator(
        this.config,
        fbConfig,
        this.fetcher,
        this.searchService,
        {
          ...fallbackOptions,
          providerOptions,
        },
      );
    } else {
      this.fallback = null;
    }
  }

  public async generate(
    messages: readonly ChatMessage[],
    externalSignal?: AbortSignal,
    options?: GenerationOptions,
  ): Promise<string> {
    if (messages.length === 0 || !hasChatMessageContent(messages.at(-1)?.content)) {
      throw new Error("At least one non-empty chat message is required.");
    }

    if (this.fallback) {
      return this.fallback.generate(messages, externalSignal, options);
    }

    return this.generateDirect(messages, externalSignal, options);
  }

  private async generateDirect(
    messages: readonly ChatMessage[],
    externalSignal?: AbortSignal,
    options?: GenerationOptions,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref?.();

    const abortFromCaller = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      return await this.provider.generate(messages, controller.signal, options);
    } catch (error) {
      if (
        error instanceof AiProviderError ||
        error instanceof AiRefusalError ||
        error instanceof AiIncompleteResponseError ||
        error instanceof AiTimeoutError ||
        error instanceof AiNetworkError
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
