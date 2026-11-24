import type { ChatMessage, GenerationOptions } from "../types.js";

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
