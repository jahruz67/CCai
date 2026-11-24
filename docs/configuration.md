# Configuration

[Documentation](README.md) · [Setup](setup.md) · [Deployment](deployment.md)

Set environment variables in `.env` or your host's secret settings. Start with [.env.example](../.env.example). Defaults below are application defaults; values in `.env` override them.

## Discord and access

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | Bot token |
| `DISCORD_APPLICATION_ID` | blank | Application ID for command registration |
| `DISCORD_GUILD_ID` | blank | Register commands in one server instead of globally |
| `DISCORD_GUILD_MEMBERS_INTENT` | `false` | Enable full member listings; also enable the intent in the portal |
| `BOT_PREFIX` | `cc` | Case-insensitive message prefix |
| `AI_ADMIN_ROLES` | blank | Comma-separated role IDs or exact names allowed to manage the server; the owner is always allowed |
| `ALLOWED_CHANNEL_IDS` | blank | Optional comma-separated channel allowlist |
| `COOLDOWN_SECONDS` | `3` | Per-user delay between AI requests |
| `MAX_CONCURRENT_REQUESTS` | `4` | Maximum simultaneous provider calls |

Channel restrictions apply inside servers. DMs remain available; threads inherit access from an allowlisted parent channel.

## AI provider

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_API_KEY` | required | Provider API key |
| `AI_API_STYLE` | `responses` | `responses`, `google-native`, or `chat-completions` |
| `AI_MODEL` | `gpt-5-mini` | Provider model name |
| `AI_BASE_URL` | automatic | Provider endpoint; defaults according to API style |
| `AI_TIMEOUT_MS` | `45000` | Provider timeout in milliseconds |
| `AI_MAX_OUTPUT_TOKENS` | `800` | Response token limit |
| `AI_REASONING_EFFORT` | `off` | `off`, `none`, `low`, `medium`, or `high` |
| `AI_CHAT_TOKEN_FIELD` | `auto` | Chat Completions token field: `auto`, `max_tokens`, or `max_completion_tokens` |
| `SYSTEM_PROMPT` | built in | Override personality and response rules |

OpenAI uses `responses` with the default endpoint `https://api.openai.com/v1`.
For Google's Gemini/Gemma API, set `AI_API_STYLE=google-native` and your model name; the default endpoint is `https://generativelanguage.googleapis.com/v1beta`.
For OpenAI-compatible providers, set `AI_API_STYLE=chat-completions`, `AI_BASE_URL`, and `AI_MODEL`.

### Retries and fallback models

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_RETRY_ENABLED` | `true` | Retry temporary Google API overload errors |
| `AI_RETRY_MAX_ATTEMPTS` | `3` | Total attempts, including the initial request |
| `AI_RETRY_INITIAL_DELAY_MS` | `1000` | Initial backoff delay |
| `AI_RETRY_MAX_DELAY_MS` | `4000` | Maximum backoff delay |
| `AI_REQUEST_TIMEOUT_MS` | `15000` | Per-request timeout |
| `AI_FALLBACK_ENABLED` | `true` | Try configured backup models after recoverable failures |
| `AI_FALLBACK_MODELS` | blank | Comma-separated backup models, tried in order |
| `AI_FALLBACK_MAX_RETRIES` | `1` | Transient retries per model |
| `AI_FALLBACK_TIMEOUT_MS` | `15000` | Timeout per fallback model |
| `AI_FALLBACK_CIRCUIT_BREAKER_THRESHOLD` | `0` | Failures before temporarily skipping the primary model; `0` disables this |
| `AI_FALLBACK_CIRCUIT_BREAKER_COOLDOWN_MS` | `60000` | Time before trying the primary again |
| `AI_FALLBACK_API_KEY` | blank | Shared fallback API key |
| `AI_FALLBACK_BASE_URL` | blank | Shared fallback endpoint |
| `AI_FALLBACK_API_STYLE` | blank | Shared fallback protocol |
| `AI_FALLBACK_CONFIG` | blank | JSON array of fallback configurations |

Backups use the primary provider settings unless overridden. For a backup using another provider:

```dotenv
AI_FALLBACK_MODELS=backup-model
AI_FALLBACK_1_API_STYLE=chat-completions
AI_FALLBACK_1_BASE_URL=https://provider.example/v1
AI_FALLBACK_1_API_KEY=your-backup-key
```

Use `_2_`, `_3_`, etc. for later models, or define the list with `AI_FALLBACK_CONFIG`:

```dotenv
AI_FALLBACK_CONFIG=[{"model":"backup-model","style":"chat-completions","baseUrl":"https://provider.example/v1","apiKey":"your-backup-key"}]
```

## Web search

DuckDuckGo works without an API key.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_WEB_SEARCH_ENABLED` | `true` | Allow AI-assisted web search |
| `SEARCH_PROVIDER` | `duckduckgo` | `duckduckgo`, `auto`, `tavily`, `brave`, or `searxng` |
| `SEARCH_MAX_RESULTS` | `5` | Maximum search results |
| `SEARCH_TIMEOUT_MS` | `10000` | Search timeout in milliseconds |
| `TAVILY_API_KEY` | blank | Tavily key |
| `BRAVE_API_KEY` | blank | Brave Search key |
| `SEARXNG_BASE_URL` | blank | SearXNG instance URL |

## Conversation context

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_HISTORY_ENABLED` | `true` | Retain recent context per user and channel |
| `REPLY_CONTEXT_ENABLED` | `true` | Include referenced Discord messages |
| `MAX_REPLY_CONTEXT_CHARS` | `4000` | Referenced message character limit |
| `MAX_REPLY_CHAIN_DEPTH` | `3` | Maximum reply chain depth |
| `MAX_HISTORY_CHARS` | `12000` | Retained history character limit |
| `HISTORY_TTL_MINUTES` | `30` | Expiry after the last successful answer |

Recent context lives in process memory and disappears on restart. Failed requests are not added to history.

## Persistent memory

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | blank | PostgreSQL connection URL; `MEMORY_DATABASE_URL` is also accepted |
| `DATABASE_SSL` | `false` | Enable TLS; overrides SSL parameters in the URL |
| `MEMORY_ENABLED` | `true` | Enable saved memories when a database is configured |

Leave `DATABASE_URL` empty to run without saved memories. For Aiven or another TLS-only database, set `DATABASE_SSL=true`. The bot creates the `memories` table on startup.

## Docker image

`CCAI_IMAGE` defaults to `ghcr.io/jahruz67/ccai:latest`. Set it to a published build tag to pin a version or roll back. See [deployment](deployment.md).
