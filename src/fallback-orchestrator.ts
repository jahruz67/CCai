import type {
  AiFallbackConfig,
  AiFallbackModelConfig,
  BotConfig,
} from "./config.js";
import {
  AiAllModelsFailedError,
  AiIncompleteResponseError,
  AiNetworkError,
  AiProviderError,
  AiRefusalError,
  AiTimeoutError,
} from "./ai-errors.js";
import type { AiProvider, FetchLike } from "./providers/types.js";
import { createAiProvider } from "./providers/factory.js";
import type { GoogleNativeProviderOptions } from "./providers/google-native-provider.js";
import type { SearchService } from "./search-provider.js";
import type { ChatMessage } from "./types.js";

export type FallbackLogger = (message: string) => void;

export interface FallbackOrchestratorOptions {
  googleOptions?: GoogleNativeProviderOptions;
  logger?: FallbackLogger;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export interface CircuitBreakerOptions {
  cooldownMs: number;
  threshold: number;
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;

  public constructor(private readonly options: CircuitBreakerOptions) {}

  public isOpen(): boolean {
    if (this.options.threshold <= 0) {
      return false;
    }
    if (this.consecutiveFailures < this.options.threshold) {
      return false;
    }
    if (Date.now() >= this.openUntil) {
      return false;
    }
    return true;
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  public recordFailure(): void {
    if (this.options.threshold <= 0) {
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.options.threshold) {
      this.openUntil = Date.now() + this.options.cooldownMs;
    }
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  public reset(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }
}

export { AiAllModelsFailedError };

export interface ErrorClassification {
  category:
    | "refusal"
    | "unauthorized"
    | "rate_limited"
    | "service_unavailable"
    | "model_not_found"
    | "bad_request"
    | "timeout"
    | "network_error"
    | "incomplete"
    | "unknown";
  httpStatus?: number;
  isEligibleForFallback: boolean;
  isRetryableOnSameModel: boolean;
  message: string;
}

export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof AiRefusalError) {
    return {
      category: "refusal",
      isEligibleForFallback: false,
      isRetryableOnSameModel: false,
      message: error.message,
    };
  }

  if (error instanceof AiIncompleteResponseError) {
    return {
      category: "incomplete",
      isEligibleForFallback: false,
      isRetryableOnSameModel: false,
      message: error.message,
    };
  }

  if (error instanceof AiTimeoutError) {
    return {
      category: "timeout",
      isEligibleForFallback: true,
      isRetryableOnSameModel: true,
      message: error.message,
    };
  }

  if (error instanceof AiNetworkError) {
    return {
      category: "network_error",
      isEligibleForFallback: true,
      isRetryableOnSameModel: true,
      message: error.message,
    };
  }

  if (error instanceof AiProviderError) {
    const status = error.status;
    const message = error.message;

    if (status === 401 || status === 403) {
      return {
        category: "unauthorized",
        httpStatus: status,
        isEligibleForFallback: false, // may become true only if next candidate has distinct credentials
        isRetryableOnSameModel: false,
        message,
      };
    }

    if (status === 404 || /not found/i.test(message)) {
      return {
        category: "model_not_found",
        httpStatus: status,
        isEligibleForFallback: true,
        isRetryableOnSameModel: false,
        message,
      };
    }

    if (status === 429) {
      return {
        category: "rate_limited",
        httpStatus: status,
        isEligibleForFallback: true,
        isRetryableOnSameModel: false,
        message,
      };
    }

    if (status === 503) {
      return {
        category: "service_unavailable",
        httpStatus: status,
        isEligibleForFallback: true,
        isRetryableOnSameModel: true,
        message,
      };
    }

    if (status === 500 || status === 502 || status === 504) {
      return {
        category: "service_unavailable",
        httpStatus: status,
        isEligibleForFallback: true,
        isRetryableOnSameModel: true,
        message,
      };
    }

    if (status === 400) {
      return {
        category: "bad_request",
        httpStatus: status,
        isEligibleForFallback: false, // may become true only if cross-provider
        isRetryableOnSameModel: false,
        message,
      };
    }

    if (status >= 500) {
      return {
        category: "service_unavailable",
        httpStatus: status,
        isEligibleForFallback: true,
        isRetryableOnSameModel: true,
        message,
      };
    }

    return {
      category: "unknown",
      httpStatus: status,
      isEligibleForFallback: false,
      isRetryableOnSameModel: false,
      message,
    };
  }

  if (error instanceof Error) {
    if (error.name === "AbortError" || /timeout/i.test(error.message)) {
      return {
        category: "timeout",
        isEligibleForFallback: true,
        isRetryableOnSameModel: true,
        message: error.message,
      };
    }

    return {
      category: "network_error",
      isEligibleForFallback: true,
      isRetryableOnSameModel: true,
      message: error.message,
    };
  }

  return {
    category: "unknown",
    isEligibleForFallback: false,
    isRetryableOnSameModel: false,
    message: String(error),
  };
}

export function canFallbackToCandidate(
  error: unknown,
  currentCandidate: ResolvedCandidateConfig,
  nextCandidate: ResolvedCandidateConfig,
): boolean {
  const classification = classifyError(error);

  if (
    classification.category === "refusal" ||
    classification.category === "incomplete"
  ) {
    return false;
  }

  if (classification.category === "unauthorized") {
    // Only attempt fallback if the next candidate provides a distinct API key or distinct provider endpoint
    const isDifferentKey =
      Boolean(nextCandidate.apiKey) &&
      nextCandidate.apiKey !== currentCandidate.apiKey;
    const isDifferentProvider =
      nextCandidate.baseUrl !== currentCandidate.baseUrl ||
      nextCandidate.style !== currentCandidate.style;
    return isDifferentKey || isDifferentProvider;
  }

  if (classification.category === "bad_request") {
    // Only attempt fallback for client bad request if next candidate uses a different provider style/endpoint
    return (
      nextCandidate.style !== currentCandidate.style ||
      nextCandidate.baseUrl !== currentCandidate.baseUrl
    );
  }

  return classification.isEligibleForFallback;
}

export interface ResolvedCandidateConfig {
  apiKey: string;
  baseUrl: string;
  chatTokenField: "auto" | "max_tokens" | "max_completion_tokens";
  maxOutputTokens: number;
  model: string;
  reasoningEffort: "off" | "none" | "low" | "medium" | "high";
  retry?: BotConfig["ai"]["retry"];
  style: "responses" | "chat-completions" | "google-native";
  systemPrompt: string;
  timeoutMs: number;
  webSearchEnabled: boolean;
}

export function resolveCandidates(
  primaryConfig: BotConfig["ai"],
  fallbackConfig: AiFallbackConfig,
): ResolvedCandidateConfig[] {
  const primaryCandidate: ResolvedCandidateConfig = {
    apiKey: primaryConfig.apiKey,
    baseUrl: primaryConfig.baseUrl,
    chatTokenField: primaryConfig.chatTokenField,
    maxOutputTokens: primaryConfig.maxOutputTokens,
    model: primaryConfig.model,
    reasoningEffort: primaryConfig.reasoningEffort,
    retry: primaryConfig.retry,
    style: primaryConfig.style,
    systemPrompt: primaryConfig.systemPrompt,
    timeoutMs: primaryConfig.timeoutMs,
    webSearchEnabled: primaryConfig.webSearchEnabled,
  };

  const candidates: ResolvedCandidateConfig[] = [primaryCandidate];

  if (!fallbackConfig.enabled) {
    return candidates;
  }

  for (const f of fallbackConfig.models) {
    const style =
      f.style ??
      (isGoogleModel(f.model)
        ? "google-native"
        : primaryConfig.style);

    let defaultBaseUrl = primaryConfig.baseUrl;
    if (style === "google-native") {
      defaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    } else if (style === "responses" || style === "chat-completions") {
      defaultBaseUrl =
        primaryConfig.style === style
          ? primaryConfig.baseUrl
          : "https://api.openai.com/v1";
    }

    candidates.push({
      apiKey: f.apiKey ?? primaryConfig.apiKey,
      baseUrl: f.baseUrl ?? defaultBaseUrl,
      chatTokenField: f.chatTokenField ?? primaryConfig.chatTokenField,
      maxOutputTokens: f.maxOutputTokens ?? primaryConfig.maxOutputTokens,
      model: f.model,
      reasoningEffort: f.reasoningEffort ?? primaryConfig.reasoningEffort,
      retry: primaryConfig.retry,
      style,
      systemPrompt: primaryConfig.systemPrompt,
      timeoutMs: f.timeoutMs ?? fallbackConfig.timeoutMs ?? 15_000,
      webSearchEnabled: f.webSearchEnabled ?? primaryConfig.webSearchEnabled,
    });
  }

  return candidates;
}

function isGoogleModel(model: string): boolean {
  return /^(?:models\/)?(?:gemini|gemma)/i.test(model);
}

export async function sleep(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw new Error("Generation aborted by caller.");
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Generation aborted by caller."));
      },
      { once: true },
    );
  });
}

export class FallbackOrchestrator {
  private readonly candidates: ResolvedCandidateConfig[];
  private readonly circuitBreaker: CircuitBreaker;
  private readonly googleOptions?: GoogleNativeProviderOptions;
  private readonly logger: FallbackLogger;
  private readonly maxRetries: number;
  private readonly providers = new Map<number, AiProvider>();
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  public constructor(
    primaryConfig: BotConfig["ai"],
    fallbackConfig: AiFallbackConfig,
    private readonly fetcher: FetchLike,
    private readonly searchService?: SearchService,
    options: FallbackOrchestratorOptions = {},
  ) {
    this.googleOptions = options.googleOptions;
    this.logger = options.logger ?? ((msg) => console.log(msg));
    this.maxRetries = fallbackConfig.maxRetries;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 2_000;
    this.circuitBreaker = new CircuitBreaker({
      cooldownMs: fallbackConfig.circuitBreakerCooldownMs,
      threshold: fallbackConfig.circuitBreakerThreshold,
    });
    this.candidates = resolveCandidates(primaryConfig, fallbackConfig);
  }

  public getCandidates(): readonly ResolvedCandidateConfig[] {
    return this.candidates;
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public async generate(
    messages: readonly ChatMessage[],
    externalSignal?: AbortSignal,
  ): Promise<string> {
    const attemptsRecord: Array<{
      attempt: number;
      error: unknown;
      model: string;
      providerStyle: string;
    }> = [];

    let startIndex = 0;
    if (this.candidates.length > 1 && this.circuitBreaker.isOpen()) {
      this.logger(
        `Circuit breaker OPEN for primary model ${this.candidates[0]!.model} (${this.circuitBreaker.getConsecutiveFailures()} consecutive failures). Skipping to fallback model ${this.candidates[1]!.model}.`,
      );
      startIndex = 1;
    }

    let lastError: unknown;
    let lastStatus = 503;

    for (
      let candidateIdx = startIndex;
      candidateIdx < this.candidates.length;
      candidateIdx++
    ) {
      const candidate = this.candidates[candidateIdx]!;
      const isPrimary = candidateIdx === 0;
      const allowedRetries = isPrimary
        ? this.maxRetries
        : Math.min(this.maxRetries, 1);
      const totalAttempts = 1 + allowedRetries;

      for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        if (externalSignal?.aborted) {
          throw new Error("Generation aborted by caller.");
        }

        if (attempt > 1) {
          const delay = Math.min(
            this.retryMaxDelayMs,
            this.retryBaseDelayMs * Math.pow(2, attempt - 2),
          );
          if (isPrimary) {
            this.logger(`Retrying primary model: attempt ${attempt}`);
          } else {
            this.logger(
              `Retrying fallback model ${candidate.model}: attempt ${attempt}`,
            );
          }
          await sleep(delay, externalSignal);
        }

        try {
          const provider = this.getProvider(candidateIdx, candidate);
          const response = await this.executeWithTimeout(
            provider,
            messages,
            candidate.timeoutMs,
            externalSignal,
          );

          if (!isPrimary) {
            this.logger("Fallback model succeeded");
          }
          if (isPrimary) {
            this.circuitBreaker.recordSuccess();
          }

          return response;
        } catch (error) {
          lastError = error;
          attemptsRecord.push({
            attempt,
            error,
            model: candidate.model,
            providerStyle: candidate.style,
          });

          if (externalSignal?.aborted) {
            throw error;
          }

          const classification = classifyError(error);
          if (classification.httpStatus) {
            lastStatus = classification.httpStatus;
          }

          const statusOrCategory = classification.httpStatus
            ? `HTTP ${classification.httpStatus}`
            : classification.category;

          if (isPrimary) {
            this.logger(
              `Primary model ${candidate.model} failed: ${statusOrCategory}`,
            );
          } else {
            this.logger(
              `Fallback model ${candidate.model} failed: ${statusOrCategory}`,
            );
          }

          if (classification.category === "refusal") {
            throw error;
          }

          if (isPrimary) {
            this.circuitBreaker.recordFailure();
          }

          // The provider may have already consumed its same-model retry budget.
          const retriesExhausted =
            (error instanceof AiProviderError ||
              error instanceof AiTimeoutError ||
              error instanceof AiNetworkError) &&
            error.retriesExhausted;
          const canRetrySame =
            classification.isRetryableOnSameModel &&
            !retriesExhausted &&
            attempt < totalAttempts;
          if (canRetrySame) {
            continue;
          }

          const nextCandidate = this.candidates[candidateIdx + 1];
          if (
            nextCandidate &&
            canFallbackToCandidate(error, candidate, nextCandidate)
          ) {
            this.logger(`Switching to fallback model: ${nextCandidate.model}`);
            break;
          }

          if (classification.category === "unauthorized") {
            throw error;
          }

          break;
        }
      }
    }

    this.logger("All configured AI models failed");

    if (lastError instanceof AiProviderError) {
      throw new AiAllModelsFailedError(
        `All configured AI models failed. Last error: ${lastError.message}`,
        attemptsRecord,
        lastError.status,
      );
    }

    throw new AiAllModelsFailedError(
      `All configured AI models failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      attemptsRecord,
      lastStatus,
    );
  }

  private getProvider(
    index: number,
    candidate: ResolvedCandidateConfig,
  ): AiProvider {
    let provider = this.providers.get(index);
    if (!provider) {
      provider = createAiProvider(
        candidate as unknown as BotConfig["ai"],
        this.fetcher,
        this.searchService,
        this.googleOptions,
      );
      this.providers.set(index, provider);
    }
    return provider;
  }

  private async executeWithTimeout(
    provider: AiProvider,
    messages: readonly ChatMessage[],
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<string> {
    const controller = new AbortController();

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        controller.abort();
        cleanup();
        reject(new AiTimeoutError());
      }, timeoutMs);
      timer.unref?.();

      const onCallerAbort = () => {
        if (settled) return;
        settled = true;
        controller.abort();
        cleanup();
        reject(new Error("Generation aborted by caller."));
      };

      const cleanup = () => {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onCallerAbort);
      };

      externalSignal?.addEventListener("abort", onCallerAbort, { once: true });

      provider
        .generate(messages, controller.signal)
        .then((result) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          cleanup();

          if (
            error instanceof AiProviderError ||
            error instanceof AiRefusalError ||
            error instanceof AiIncompleteResponseError ||
            error instanceof AiTimeoutError ||
            error instanceof AiNetworkError
          ) {
            reject(error);
            return;
          }

          if (controller.signal.aborted) {
            if (externalSignal?.aborted) {
              reject(new Error("Generation aborted by caller."));
              return;
            }
            reject(new AiTimeoutError());
            return;
          }

          reject(new AiNetworkError());
        });
    });
  }
}
