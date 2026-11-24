import type { BotConfig } from "../config.js";
import type { SearchService } from "../search-provider.js";
import type { AiProvider, AiProviderOptions, FetchLike } from "./types.js";
import { ResponsesProvider } from "./responses-provider.js";
import { ChatCompletionsProvider } from "./chat-completions-provider.js";
import { GoogleNativeProvider } from "./google-native-provider.js";

export function createAiProvider(
  config: BotConfig["ai"],
  fetcher: FetchLike,
  searchService?: SearchService,
  options?: AiProviderOptions,
): AiProvider {
  switch (config.style) {
    case "responses":
      return new ResponsesProvider(config, fetcher, searchService, options);
    case "chat-completions":
      return new ChatCompletionsProvider(config, fetcher, searchService, options);
    case "google-native":
      return new GoogleNativeProvider(config, fetcher, searchService, options);
    default:
      throw new Error(`Unsupported AI API style: ${(config as { style: string }).style}`);
  }
}
