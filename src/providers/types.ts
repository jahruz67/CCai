import type { ChatMessage, GenerationOptions } from "../types.js";
import type { AiRetryConfig, RetryLogger } from "../retry-strategy.js";

export interface AiProviderOptions {
  jitterFn?: () => number;
  logger?: RetryLogger;
  retryOptions?: Partial<AiRetryConfig>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AiProvider {
  readonly style: "responses" | "chat-completions" | "google-native";
  generate(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    options?: GenerationOptions,
  ): Promise<string>;
}
