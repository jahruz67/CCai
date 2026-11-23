import { z } from "zod";
import type { AiRetryConfig } from "./retry-strategy.js";
export type { AiRetryConfig };

export const DEFAULT_SYSTEM_PROMPT = `You are CC, an expert, highly accurate, and intelligent Discord assistant.

Core Principles:
1. Universal Accuracy & Anti-Hallucination:
- Base all answers on verified facts, established scientific principles, and authoritative sources. Never guess, fabricate information, or invent citations/formulas.
- If an answer is uncertain, evolving, or lacks consensus, state this transparently.
- If a user's question contains a false, mistaken, or impossible premise, politely clarify the correct facts before answering.

2. Domain-Specific Rigor:
- Physics & Physical Sciences: Ground explanations in fundamental physical laws, conservation principles, and established constants. Verify dimensional analysis and unit consistency (SI units by default). State key assumptions (e.g. ideal conditions, non-relativistic vs. relativistic).
- Mathematics & Logic: Verify all arithmetic, algebraic steps, domain constraints, and boundary conditions. Guard against edge cases like division by zero.
- Chemistry & Medicine/Health: Ensure balanced equations, correct stoichiometry, and alignment with peer-reviewed clinical guidelines (e.g., CDC, WHO, NIH).
- Computer Science & Programming: Provide valid, idiomatic, type-safe code with attention to edge cases, complexity, and security.
- History, Law & Economics: Maintain strict chronological validity, primary historical records, official economic data, and valid legal distinctions.

3. Live Search & Reputable Sourcing:
- When searching or answering queries requiring live/current data, rely strictly on reputable and authoritative sources: official government domains (.gov, .mil, gov.uk), academic/research institutions (.edu, .ac.uk), primary documentation, and established news organizations with high editorial standards (e.g., Reuters, AP, BBC, NPR).
- Disregard content farms, clickbait, unverified social media claims, SEO spam, and user forum rumors.

4. Output Formatting & Math/LaTeX for Discord:
- Deliver a direct, clear answer upfront, followed by structured supporting details when helpful.
- Use clean Discord-compatible Markdown (bold headers, bullet points, numbered steps, tables, and syntax-highlighted code blocks).
- For Mathematics & LaTeX: Use clean inline code (e.g., \`f(x) = x^2 + 1\`) or standard Unicode math symbols (x², √, ±, π, Δ, ∫, ∑, ≈, ≠, ≤, ≥) for inline reading. For multi-line derivations or complex equations, use dedicated \`\`\`latex or formatted code blocks.
- Never generate raw @everyone, @here, or user/role pings.

5. Conciseness & Response Length:
- Be concise and focused, targeting ~200 words or less for typical answers.
- Do not make important explanations overly brief; maintain necessary depth, nuance, and clarity for critical concepts.
- Provide longer, in-depth responses only when the user explicitly asks for more detail or when the topic genuinely necessitates a longer answer.`;

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.string().trim().url().optional(),
);

const environmentSchema = z.object({
  AI_API_KEY: z.string().trim().min(1, "AI_API_KEY is required"),
  AI_API_STYLE: z
    .enum(["responses", "chat-completions", "google-native"])
    .default("responses"),
  AI_CHAT_TOKEN_FIELD: z
    .enum(["auto", "max_tokens", "max_completion_tokens"])
    .default("auto"),
  AI_BASE_URL: optionalUrl,
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(16_384).default(800),
  AI_MODEL: z.string().trim().min(1).default("gpt-5-mini"),
  AI_REASONING_EFFORT: z
    .enum(["off", "none", "low", "medium", "high"])
    .default("off"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  AI_RETRY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AI_RETRY_INITIAL_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  AI_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  AI_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).max(300_000).default(4_000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(45_000),
  AI_WEB_SEARCH_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AI_FALLBACK_API_KEY: z.string().trim().optional(),
  AI_FALLBACK_API_STYLE: z
    .enum(["responses", "chat-completions", "google-native"])
    .optional(),
  AI_FALLBACK_BASE_URL: optionalUrl,
  AI_FALLBACK_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .default(60_000),
  AI_FALLBACK_CIRCUIT_BREAKER_THRESHOLD: z.coerce
    .number()
    .int()
    .min(0)
    .max(50)
    .default(0),
  AI_FALLBACK_CONFIG: z.string().trim().optional(),
  AI_FALLBACK_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AI_FALLBACK_MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(10)
    .default(1),
  AI_FALLBACK_MODELS: z.string().default(""),
  AI_FALLBACK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(15_000),
  AI_ADMIN_ROLES: z.string().default(""),
  ALLOWED_CHANNEL_IDS: z.string().default(""),
  BOT_PREFIX: z.string().trim().min(1).max(16).default("cc"),
  BRAVE_API_KEY: z.string().trim().optional(),
  CHAT_HISTORY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  COOLDOWN_SECONDS: z.coerce.number().min(0).max(300).default(3),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_URL: z.string().trim().optional(),
  DISCORD_APPLICATION_ID: z.string().trim().optional(),
  DISCORD_GUILD_ID: z.string().trim().optional(),
  DISCORD_GUILD_MEMBERS_INTENT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DISCORD_TOKEN: z.string().trim().min(1, "DISCORD_TOKEN is required"),
  HISTORY_TTL_MINUTES: z.coerce.number().min(1).max(10_080).default(30),
  MAX_CONTEXT_CHARS: z.coerce.number().int().min(0).max(500_000).optional(),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(100).default(4),
  MAX_HISTORY_CHARS: z.coerce.number().int().min(0).max(500_000).optional(),
  MAX_MEMORIES_PER_SCOPE: z.coerce.number().int().min(1).max(1_000).default(100),
  MAX_MEMORY_KEY_CHARS: z.coerce.number().int().min(1).max(200).default(100),
  MAX_MEMORY_VALUE_CHARS: z.coerce.number().int().min(1).max(4_000).default(1_000),
  MAX_QUESTION_CHARS: z.coerce.number().int().min(100).max(50_000).default(4_000),
  MAX_REPLY_CHAIN_DEPTH: z.coerce.number().int().min(1).max(10).default(3),
  MAX_REPLY_CONTEXT_CHARS: z.coerce.number().int().min(100).max(50_000).default(4_000),
  MEMORY_DATABASE_URL: z.string().trim().optional(),
  MEMORY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  REPLY_CONTEXT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  SEARCH_PROVIDER: z
    .enum(["duckduckgo", "auto", "tavily", "brave", "searxng"])
    .default("duckduckgo"),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  SEARXNG_BASE_URL: z.string().trim().optional(),
  SYSTEM_PROMPT: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_SYSTEM_PROMPT),
  TAVILY_API_KEY: z.string().trim().optional(),
});

const registrationEnvironmentSchema = z.object({
  DISCORD_APPLICATION_ID: z
    .string()
    .trim()
    .min(1, "DISCORD_APPLICATION_ID is required"),
  DISCORD_GUILD_ID: z.string().trim().optional(),
  DISCORD_TOKEN: z.string().trim().min(1, "DISCORD_TOKEN is required"),
});

export interface AiFallbackModelConfig {
  apiKey?: string;
  baseUrl?: string;
  chatTokenField?: "auto" | "max_tokens" | "max_completion_tokens";
  maxOutputTokens?: number;
  model: string;
  reasoningEffort?: "off" | "none" | "low" | "medium" | "high";
  style?: "responses" | "chat-completions" | "google-native";
  timeoutMs?: number;
  webSearchEnabled?: boolean;
}

export interface AiFallbackConfig {
  circuitBreakerCooldownMs: number;
  circuitBreakerThreshold: number;
  enabled: boolean;
  maxRetries: number;
  models: AiFallbackModelConfig[];
  timeoutMs: number;
}

export interface BotConfig {
  ai: {
    apiKey: string;
    baseUrl: string;
    chatTokenField: "auto" | "max_tokens" | "max_completion_tokens";
    fallback?: AiFallbackConfig;
    maxOutputTokens: number;
    model: string;
    reasoningEffort: "off" | "none" | "low" | "medium" | "high";
    retry?: AiRetryConfig;
    style: "responses" | "chat-completions" | "google-native";
    systemPrompt: string;
    timeoutMs: number;
    webSearchEnabled: boolean;
  };
  allowedChannelIds: ReadonlySet<string>;
  adminRoles: {
    ids: ReadonlySet<string>;
    names: ReadonlySet<string>;
  };
  cooldownMs: number;
  discord: {
    applicationId?: string;
    guildId?: string;
    membersIntentEnabled: boolean;
    token: string;
  };
  history: {
    enabled: boolean;
    maxChars: number;
    ttlMs: number;
  };
  maxConcurrentRequests: number;
  maxQuestionChars: number;
  memory: {
    databaseUrl?: string;
    ssl: boolean;
    enabled: boolean;
    maxKeyChars: number;
    maxPerScope: number;
    maxValueChars: number;
  };
  prefix: string;
  replyContext: {
    enabled: boolean;
    maxChainDepth: number;
    maxChars: number;
  };
  search: {
    braveApiKey?: string;
    maxResults: number;
    provider: "duckduckgo" | "auto" | "tavily" | "brave" | "searxng";
    searxngBaseUrl?: string;
    tavilyApiKey?: string;
    timeoutMs: number;
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }

  const values = parsed.data;
  const allowedChannelIds = new Set(
    values.ALLOWED_CHANNEL_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const adminRoleTokens = values.AI_ADMIN_ROLES.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const adminRoleIds = new Set(
    adminRoleTokens.filter((value) => /^\d{17,20}$/.test(value)),
  );
  const adminRoleNames = new Set(
    adminRoleTokens
      .filter((value) => !/^\d{17,20}$/.test(value))
      .map((value) => value.toLocaleLowerCase()),
  );

  const maxHistoryChars =
    values.MAX_HISTORY_CHARS ?? values.MAX_CONTEXT_CHARS ?? 12_000;

  const databaseUrl = values.DATABASE_URL || values.MEMORY_DATABASE_URL;
  const isMemoryEnabled = values.MEMORY_ENABLED && Boolean(databaseUrl);

  const defaultGoogleBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
  const defaultOpenAiBaseUrl = "https://api.openai.com/v1";

  const rawBaseUrl =
    values.AI_BASE_URL ??
    (values.AI_API_STYLE === "google-native"
      ? defaultGoogleBaseUrl
      : defaultOpenAiBaseUrl);

  const resolvedBaseUrl =
    values.AI_API_STYLE === "google-native" &&
    (rawBaseUrl === defaultOpenAiBaseUrl || rawBaseUrl.includes("api.openai.com"))
      ? defaultGoogleBaseUrl
      : rawBaseUrl;

  const fallback = parseFallbackConfig(values, environment);

  return {
    ai: {
      apiKey: values.AI_API_KEY,
      baseUrl: resolvedBaseUrl.replace(/\/+$/, ""),
      chatTokenField: values.AI_CHAT_TOKEN_FIELD,
      fallback,
      maxOutputTokens: values.AI_MAX_OUTPUT_TOKENS,
      model: values.AI_MODEL,
      reasoningEffort: values.AI_REASONING_EFFORT,
      retry: {
        enabled: values.AI_RETRY_ENABLED,
        initialDelayMs: values.AI_RETRY_INITIAL_DELAY_MS,
        maxAttempts: values.AI_RETRY_MAX_ATTEMPTS,
        maxDelayMs: values.AI_RETRY_MAX_DELAY_MS,
        requestTimeoutMs: values.AI_REQUEST_TIMEOUT_MS,
      },
      style: values.AI_API_STYLE,
      systemPrompt: values.SYSTEM_PROMPT,
      timeoutMs: values.AI_TIMEOUT_MS,
      webSearchEnabled: values.AI_WEB_SEARCH_ENABLED,
    },
    allowedChannelIds,
    adminRoles: {
      ids: adminRoleIds,
      names: adminRoleNames,
    },
    cooldownMs: values.COOLDOWN_SECONDS * 1_000,
    discord: {
      ...(values.DISCORD_APPLICATION_ID
        ? { applicationId: values.DISCORD_APPLICATION_ID }
        : {}),
      ...(values.DISCORD_GUILD_ID ? { guildId: values.DISCORD_GUILD_ID } : {}),
      membersIntentEnabled: values.DISCORD_GUILD_MEMBERS_INTENT,
      token: values.DISCORD_TOKEN,
    },
    history: {
      enabled: values.CHAT_HISTORY_ENABLED,
      maxChars: maxHistoryChars,
      ttlMs: values.HISTORY_TTL_MINUTES * 60_000,
    },
    maxConcurrentRequests: values.MAX_CONCURRENT_REQUESTS,
    maxQuestionChars: values.MAX_QUESTION_CHARS,
    memory: {
      ...(databaseUrl ? { databaseUrl } : {}),
      ssl: values.DATABASE_SSL,
      enabled: isMemoryEnabled,
      maxKeyChars: values.MAX_MEMORY_KEY_CHARS,
      maxPerScope: values.MAX_MEMORIES_PER_SCOPE,
      maxValueChars: values.MAX_MEMORY_VALUE_CHARS,
    },
    prefix: values.BOT_PREFIX,
    replyContext: {
      enabled: values.REPLY_CONTEXT_ENABLED,
      maxChainDepth: values.MAX_REPLY_CHAIN_DEPTH,
      maxChars: values.MAX_REPLY_CONTEXT_CHARS,
    },
    search: {
      ...(values.BRAVE_API_KEY ? { braveApiKey: values.BRAVE_API_KEY } : {}),
      maxResults: values.SEARCH_MAX_RESULTS,
      provider: values.SEARCH_PROVIDER,
      ...(values.SEARXNG_BASE_URL ? { searxngBaseUrl: values.SEARXNG_BASE_URL } : {}),
      ...(values.TAVILY_API_KEY ? { tavilyApiKey: values.TAVILY_API_KEY } : {}),
      timeoutMs: values.SEARCH_TIMEOUT_MS,
    },
  };
}

export function isGoogleModelName(model: string): boolean {
  return /^(?:models\/)?(?:gemini|gemma)/i.test(model);
}

export function parseFallbackConfig(
  values: z.infer<typeof environmentSchema>,
  rawEnv: NodeJS.ProcessEnv = process.env,
): AiFallbackConfig {
  const models: AiFallbackModelConfig[] = [];

  // 1. If AI_FALLBACK_CONFIG is present, parse as JSON array
  if (values.AI_FALLBACK_CONFIG) {
    try {
      const parsed = JSON.parse(values.AI_FALLBACK_CONFIG);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === "object" &&
            typeof item.model === "string" &&
            item.model.trim()
          ) {
            const rawModel = item.model.trim();
            const rawStyle =
              item.style ??
              values.AI_FALLBACK_API_STYLE ??
              (isGoogleModelName(rawModel) ? "google-native" : values.AI_API_STYLE);

            const defaultBaseUrl =
              rawStyle === "google-native"
                ? "https://generativelanguage.googleapis.com/v1beta"
                : "https://api.openai.com/v1";

            models.push({
              apiKey:
                typeof item.apiKey === "string" && item.apiKey.trim()
                  ? item.apiKey.trim()
                  : values.AI_FALLBACK_API_KEY ?? values.AI_API_KEY,
              baseUrl:
                typeof item.baseUrl === "string" && item.baseUrl.trim()
                  ? item.baseUrl.trim()
                  : values.AI_FALLBACK_BASE_URL ?? (rawStyle === values.AI_API_STYLE ? values.AI_BASE_URL : defaultBaseUrl),
              chatTokenField: item.chatTokenField,
              maxOutputTokens:
                typeof item.maxOutputTokens === "number"
                  ? item.maxOutputTokens
                  : values.AI_MAX_OUTPUT_TOKENS,
              model: rawModel,
              reasoningEffort: item.reasoningEffort,
              style: rawStyle,
              timeoutMs:
                typeof item.timeoutMs === "number"
                  ? item.timeoutMs
                  : values.AI_FALLBACK_TIMEOUT_MS,
              webSearchEnabled:
                typeof item.webSearchEnabled === "boolean"
                  ? item.webSearchEnabled
                  : values.AI_WEB_SEARCH_ENABLED,
            });
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse AI_FALLBACK_CONFIG as JSON:", e);
    }
  }

  // 2. Parse comma-separated AI_FALLBACK_MODELS if JSON was not provided
  if (models.length === 0 && values.AI_FALLBACK_MODELS) {
    const rawTokens = values.AI_FALLBACK_MODELS.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    for (let i = 0; i < rawTokens.length; i++) {
      const token = rawTokens[i]!;
      const index = i + 1;

      let modelName = token;
      let stylePrefix: "responses" | "chat-completions" | "google-native" | undefined;

      // Check for style:model syntax, e.g. "chat-completions:llama-3.3-70b"
      if (token.includes(":")) {
        const colonIdx = token.indexOf(":");
        const prefix = token.slice(0, colonIdx).trim().toLowerCase();
        const rest = token.slice(colonIdx + 1).trim();
        if (
          prefix === "responses" ||
          prefix === "chat-completions" ||
          prefix === "google-native"
        ) {
          stylePrefix = prefix;
          modelName = rest;
        }
      }

      // Check for indexed overrides from env: AI_FALLBACK_1_MODEL, etc.
      const indexedModel = rawEnv[`AI_FALLBACK_${index}_MODEL`]?.trim();
      const indexedStyle = rawEnv[`AI_FALLBACK_${index}_API_STYLE`]?.trim() as
        | "responses"
        | "chat-completions"
        | "google-native"
        | undefined;
      const indexedApiKey = rawEnv[`AI_FALLBACK_${index}_API_KEY`]?.trim();
      const indexedBaseUrl = rawEnv[`AI_FALLBACK_${index}_BASE_URL`]?.trim();
      const indexedTimeout = rawEnv[`AI_FALLBACK_${index}_TIMEOUT_MS`]?.trim();

      const finalModel = indexedModel || modelName;
      if (!finalModel) continue;

      const finalStyle =
        indexedStyle ||
        stylePrefix ||
        values.AI_FALLBACK_API_STYLE ||
        (isGoogleModelName(finalModel) ? "google-native" : values.AI_API_STYLE);

      const defaultBaseUrl =
        finalStyle === "google-native"
          ? "https://generativelanguage.googleapis.com/v1beta"
          : "https://api.openai.com/v1";

      const finalApiKey =
        indexedApiKey ||
        values.AI_FALLBACK_API_KEY ||
        (finalStyle === values.AI_API_STYLE ? values.AI_API_KEY : undefined);

      const finalBaseUrl =
        indexedBaseUrl ||
        values.AI_FALLBACK_BASE_URL ||
        (finalStyle === values.AI_API_STYLE && values.AI_BASE_URL
          ? values.AI_BASE_URL
          : defaultBaseUrl);

      models.push({
        apiKey: finalApiKey,
        baseUrl: finalBaseUrl,
        model: finalModel,
        style: finalStyle,
        timeoutMs: indexedTimeout ? Number(indexedTimeout) : values.AI_FALLBACK_TIMEOUT_MS,
      });
    }
  }

  // 3. Also check for standalone indexed entries AI_FALLBACK_1_MODEL, AI_FALLBACK_2_MODEL etc. if AI_FALLBACK_MODELS was empty
  if (models.length === 0) {
    for (let index = 1; index <= 10; index++) {
      const indexedModel = rawEnv[`AI_FALLBACK_${index}_MODEL`]?.trim();
      if (!indexedModel) continue;

      const indexedStyle = rawEnv[`AI_FALLBACK_${index}_API_STYLE`]?.trim() as
        | "responses"
        | "chat-completions"
        | "google-native"
        | undefined;
      const indexedApiKey = rawEnv[`AI_FALLBACK_${index}_API_KEY`]?.trim();
      const indexedBaseUrl = rawEnv[`AI_FALLBACK_${index}_BASE_URL`]?.trim();
      const indexedTimeout = rawEnv[`AI_FALLBACK_${index}_TIMEOUT_MS`]?.trim();

      const finalStyle =
        indexedStyle ||
        values.AI_FALLBACK_API_STYLE ||
        (isGoogleModelName(indexedModel) ? "google-native" : values.AI_API_STYLE);

      const defaultBaseUrl =
        finalStyle === "google-native"
          ? "https://generativelanguage.googleapis.com/v1beta"
          : "https://api.openai.com/v1";

      const finalApiKey =
        indexedApiKey ||
        values.AI_FALLBACK_API_KEY ||
        (finalStyle === values.AI_API_STYLE ? values.AI_API_KEY : undefined);

      const finalBaseUrl =
        indexedBaseUrl ||
        values.AI_FALLBACK_BASE_URL ||
        (finalStyle === values.AI_API_STYLE && values.AI_BASE_URL
          ? values.AI_BASE_URL
          : defaultBaseUrl);

      models.push({
        apiKey: finalApiKey,
        baseUrl: finalBaseUrl,
        model: indexedModel,
        style: finalStyle,
        timeoutMs: indexedTimeout ? Number(indexedTimeout) : values.AI_FALLBACK_TIMEOUT_MS,
      });
    }
  }

  return {
    circuitBreakerCooldownMs: values.AI_FALLBACK_CIRCUIT_BREAKER_COOLDOWN_MS,
    circuitBreakerThreshold: values.AI_FALLBACK_CIRCUIT_BREAKER_THRESHOLD,
    enabled: values.AI_FALLBACK_ENABLED,
    maxRetries: values.AI_FALLBACK_MAX_RETRIES,
    models,
    timeoutMs: values.AI_FALLBACK_TIMEOUT_MS,
  };
}

export function loadRegistrationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): { applicationId: string; guildId?: string; token: string } {
  const parsed = registrationEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid command registration configuration:\n${details}`);
  }

  return {
    applicationId: parsed.data.DISCORD_APPLICATION_ID,
    ...(parsed.data.DISCORD_GUILD_ID
      ? { guildId: parsed.data.DISCORD_GUILD_ID }
      : {}),
    token: parsed.data.DISCORD_TOKEN,
  };
}
