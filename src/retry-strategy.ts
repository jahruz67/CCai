import {
  AiNetworkError,
  AiProviderError,
  AiTimeoutError,
} from "./ai-errors.js";
import { parseJson } from "./providers/responses-provider.js";

export interface AiRetryConfig {
  enabled: boolean;
  initialDelayMs: number;
  maxAttempts: number;
  maxDelayMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_AI_RETRY_CONFIG: AiRetryConfig = {
  enabled: true,
  initialDelayMs: 1_000,
  maxAttempts: 3,
  maxDelayMs: 4_000,
  requestTimeoutMs: 15_000,
};

export type RetryLogger = (message: string) => void;

export interface GoogleErrorDetails {
  code?: number;
  details?: unknown[];
  message?: string;
  retryDelay?: unknown;
  status?: string;
}

export function extractGoogleError(data: unknown): GoogleErrorDetails | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const parsed = data as {
    error?: GoogleErrorDetails;
  };

  return parsed.error;
}

export function isTransientGoogleError(
  status: number,
  data?: unknown,
): boolean {
  if (status === 503) {
    return true;
  }
  const errorInfo = extractGoogleError(data);
  if (errorInfo?.code === 503) {
    return true;
  }
  if (errorInfo?.status === "UNAVAILABLE") {
    return true;
  }
  return false;
}

/**
 * Parses duration formats commonly returned in Google RPC errors, such as:
 * - string: "2.5s", "1000ms", "3"
 * - number: 2.5 (seconds)
 * - protobuf Duration object: { seconds: 2, nanos: 500000000 }
 */
export function parseDurationToMs(val: unknown): number | undefined {
  if (typeof val === "number" && !isNaN(val) && val > 0) {
    return Math.round(val * 1000);
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    const secMatch = trimmed.match(/^([\d.]+)s$/i);
    if (secMatch && secMatch[1]) {
      const sec = parseFloat(secMatch[1]);
      if (!isNaN(sec) && sec > 0) {
        return Math.round(sec * 1000);
      }
    }
    const msMatch = trimmed.match(/^([\d.]+)ms$/i);
    if (msMatch && msMatch[1]) {
      const ms = parseFloat(msMatch[1]);
      if (!isNaN(ms) && ms > 0) {
        return Math.round(ms);
      }
    }
    const bareNum = parseFloat(trimmed);
    if (!isNaN(bareNum) && bareNum > 0) {
      return Math.round(bareNum * 1000);
    }
  }
  if (typeof val === "object" && val !== null) {
    const obj = val as { nanos?: unknown; seconds?: unknown };
    const seconds =
      typeof obj.seconds === "number"
        ? obj.seconds
        : typeof obj.seconds === "string"
          ? parseFloat(obj.seconds)
          : 0;
    const nanos =
      typeof obj.nanos === "number"
        ? obj.nanos
        : typeof obj.nanos === "string"
          ? parseFloat(obj.nanos)
          : 0;
    const totalMs =
      (isNaN(seconds) ? 0 : seconds * 1000) +
      (isNaN(nanos) ? 0 : Math.round(nanos / 1_000_000));
    if (totalMs > 0) {
      return totalMs;
    }
  }
  return undefined;
}

/**
 * Extracts server-provided retry delays from either:
 * 1. HTTP Retry-After header (seconds or HTTP-date)
 * 2. Google RPC error details (RetryInfo.retryDelay or error.retryDelay)
 */
export function extractServerRetryDelay(
  response: Response,
  data?: unknown,
): number | undefined {
  const retryAfter =
    response.headers.get("retry-after") ?? response.headers.get("Retry-After");
  if (retryAfter) {
    const sec = parseFloat(retryAfter);
    if (!isNaN(sec) && sec > 0) {
      return Math.round(sec * 1000);
    }
    const dateMs = Date.parse(retryAfter);
    if (!isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) {
        return diff;
      }
    }
  }

  if (data && typeof data === "object") {
    const errorInfo = extractGoogleError(data);
    if (errorInfo?.retryDelay) {
      const parsed = parseDurationToMs(errorInfo.retryDelay);
      if (parsed !== undefined) {
        return parsed;
      }
    }
    if (Array.isArray(errorInfo?.details)) {
      for (const item of errorInfo.details) {
        if (item && typeof item === "object") {
          const detail = item as Record<string, unknown>;
          if (
            detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo" ||
            "retryDelay" in detail
          ) {
            const parsed = parseDurationToMs(detail.retryDelay);
            if (parsed !== undefined) {
              return parsed;
            }
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Computes exponential backoff delay with proportional jitter (±20%).
 * Gradually increases the delay between attempts to avoid overwhelming Google's servers.
 *
 * @param retryIndex 0 for first retry (attempt 2), 1 for second retry (attempt 3), etc.
 * @param initialDelayMs Initial backoff delay (e.g. 1000ms)
 * @param maxDelayMs Maximum backoff delay (e.g. 4000ms)
 * @param jitterFn Random generator returning [0, 1). Defaults to Math.random.
 */
export function computeBackoffDelay(
  retryIndex: number,
  initialDelayMs: number,
  maxDelayMs: number,
  jitterFn: () => number = Math.random,
): number {
  const exponentialDelay = initialDelayMs * Math.pow(2, retryIndex);
  const baseDelay = Math.min(maxDelayMs, exponentialDelay);
  const random = jitterFn();
  // Jitter factor between 0.8 and 1.2 (±20% proportional jitter)
  const jitterFactor = 0.8 + 0.4 * random;
  const jitteredDelay = Math.round(baseDelay * jitterFactor);
  return Math.max(0, Math.min(maxDelayMs, jitteredDelay));
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

export interface ExecuteFetchWithRetryOptions {
  jitterFn?: () => number;
  logger?: RetryLogger;
  model: string;
  parentSignal?: AbortSignal;
  retryConfig: AiRetryConfig;
}

export interface FetchRetryResult {
  data: unknown;
  rawBody: string;
  requestId?: string;
  response: Response;
}

/**
 * Executes an HTTP fetch operation with Google's recommended retry and backoff strategy.
 * Automatically retries temporary HTTP 503 / UNAVAILABLE errors with exponential backoff and jitter.
 */
export async function executeFetchWithRetry(
  fetchFn: (attemptSignal: AbortSignal) => Promise<Response>,
  options: ExecuteFetchWithRetryOptions,
): Promise<FetchRetryResult> {
  const {
    jitterFn = Math.random,
    logger = (msg) => console.log(msg),
    model,
    parentSignal,
    retryConfig,
  } = options;

  const maxAttempts = retryConfig.enabled
    ? Math.max(1, retryConfig.maxAttempts)
    : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (parentSignal?.aborted) {
      throw new Error("Generation aborted by caller.");
    }

    const attemptController = new AbortController();
    let attemptTimedOut = false;

    // Set up per-request timeout based on AI_REQUEST_TIMEOUT_MS
    const timeoutTimer = setTimeout(() => {
      attemptTimedOut = true;
      attemptController.abort();
    }, retryConfig.requestTimeoutMs);
    timeoutTimer.unref?.();

    const onParentAbort = () => {
      attemptController.abort();
    };
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    let response: Response;
    let rawBody = "";
    let data: unknown;

    try {
      response = await fetchFn(attemptController.signal);
      rawBody = await response.text();
      data = parseJson(rawBody);
    } catch (err) {
      clearTimeout(timeoutTimer);
      parentSignal?.removeEventListener("abort", onParentAbort);

      if (parentSignal?.aborted) {
        throw new Error("Generation aborted by caller.");
      }

      if (attemptTimedOut) {
        lastError = new AiTimeoutError(retryConfig.enabled);
        if (attempt < maxAttempts) {
          const retryIndex = attempt - 1;
          const delayMs = computeBackoffDelay(
            retryIndex,
            retryConfig.initialDelayMs,
            retryConfig.maxDelayMs,
            jitterFn,
          );
          logger(
            `[AI Retry] Google API request timed out after ${retryConfig.requestTimeoutMs}ms for model "${model}" (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`,
          );
          await sleep(delayMs, parentSignal);
          continue;
        }
        logger(
          `[AI Retry] Google API retries exhausted for model "${model}" after ${maxAttempts} attempts (timeout).`,
        );
        throw lastError;
      }

      // Network error
      lastError = new AiNetworkError(retryConfig.enabled);
      if (attempt < maxAttempts) {
        const retryIndex = attempt - 1;
        const delayMs = computeBackoffDelay(
          retryIndex,
          retryConfig.initialDelayMs,
          retryConfig.maxDelayMs,
          jitterFn,
        );
        logger(
          `[AI Retry] Network error contacting Google API for model "${model}" (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`,
        );
        await sleep(delayMs, parentSignal);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeoutTimer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (parentSignal?.aborted) {
      throw new Error("Generation aborted by caller.");
    }

    if (response.ok) {
      if (attempt > 1) {
        logger(
          `[AI Retry] Google API request succeeded for model "${model}" on attempt ${attempt} after ${attempt - 1} ${attempt - 1 === 1 ? "retry" : "retries"}.`,
        );
      }
      return { data, rawBody, requestId, response };
    }

    // Response is not OK
    const status = response.status;
    const errorInfo = extractGoogleError(data);
    const is503 = isTransientGoogleError(status, data);

    if (is503 && attempt < maxAttempts) {
      const serverDelay = extractServerRetryDelay(response, data);
      const delayMs =
        serverDelay !== undefined
          ? Math.min(serverDelay, retryConfig.maxDelayMs)
          : computeBackoffDelay(
              attempt - 1,
              retryConfig.initialDelayMs,
              retryConfig.maxDelayMs,
              jitterFn,
            );

      logger(
        `[AI Retry] Google API returned HTTP ${status} for model "${model}" (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`,
      );

      await sleep(delayMs, parentSignal);
      continue;
    }

    if (is503 && attempt === maxAttempts) {
      logger(
        `[AI Retry] Google API retries exhausted for model "${model}" after ${maxAttempts} attempts (HTTP ${status}).`,
      );
    }

    const rawMessage =
      errorInfo?.message ?? `Google API returned HTTP ${response.status}.`;

    let mappedStatus = status;
    if (status === 400 && /API key not valid/i.test(rawMessage)) {
      mappedStatus = 401;
    } else if (status === 404 || /not found/i.test(rawMessage)) {
      mappedStatus = 404;
      throw new AiProviderError(
        `Model "${model}" not found or unsupported by Google API.`,
        mappedStatus,
        requestId,
      );
    }

    throw new AiProviderError(
      rawMessage,
      mappedStatus,
      requestId,
      is503 && retryConfig.enabled,
    );
  }

  if (lastError) {
    throw lastError;
  }

  throw new AiProviderError(
    `Google API request failed after ${maxAttempts} attempts.`,
    503,
  );
}
