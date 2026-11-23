# CCai


<a href="https://discord.com/oauth2/authorize?client_id=1539780033848283299">
  <img
    src="https://img.shields.io/badge/Add%20CCai%20to%20Discord-5865F2?style=flat-square&logo=discord&logoColor=white"
    alt="Add CCai to Discord"
    width="180"
  />
</a>


![C.C. from Code Geass holding pizza](./CC-and-Pizza-Hut-from-Code-Geass.jpg)

A small AI assistant for Discord. Ask it a question with a normal message:

```text
cc what is one plus one
```

It also responds to mentions, replies, DMs, `/ask`, and `/search`.

## Included

- `cc <question>` with a configurable, case-insensitive prefix.
- `cc search <query>` and `/search` for direct live web search.
- **Optional Persistent Memory & Abbreviations (Aiven PostgreSQL)**: Save custom abbreviations, definitions, and facts (`cc remember BRB = Be Right Back`, `/remember`, `/memory`, `/forget`). Automatically injected into AI questions so CC knows your terminology.
- **Universal Discord Reply Context**: When replying to any Discord message (from any user or bot) with `cc <request>`, CCai naturally understands the referenced message and its context (supports explanations, fact-checking, translation, code analysis, rewriting, summarization, rich embeds, attachments, and chained replies).
- Bot mentions, replies to the bot, direct messages, and `/ask`.
- **Free Live Web Search powered by DuckDuckGo (Zero API key needed!)**, Tavily, Brave Search, or SearXNG.
- Short-term conversation context scoped to one user and channel.
- `cc clear`, `cc help`, `cc ping`, plus matching slash commands.
- AI-assisted server management for authorized roles: channels, roles, kicks,
  bans, timeouts, nicknames, message purges, and basic server settings.
- Per-user cooldowns, question limits, and optional channel allowlisting.
- Safe response splitting for Discord's 2,000-character limit.
- Live internet search with reputable source prioritization (`.gov`, `.edu`, accredited news).
- Clean, tracking-free citation formatting with embed suppression.
- Multi-domain accuracy harness for physics, math, science, medicine, and code.
- Discord-optimized math/LaTeX formatting and formula presentation.
- No generated pings from model output.
- Native Google Gemini & Gemma API support (`google-native`), OpenAI Responses API (`responses`), and generic Chat Completions mode (`chat-completions`) with tool calling.
- **Google's Recommended API Retry and Backoff Strategy**: Automatically retries temporary HTTP 503 service overload errors using exponential backoff with jitter and server-provided retry delays (`AI_RETRY_ENABLED`, `AI_RETRY_MAX_ATTEMPTS=3`, `AI_RETRY_INITIAL_DELAY_MS=1000`, `AI_RETRY_MAX_DELAY_MS=4000`, `AI_REQUEST_TIMEOUT_MS=15000`).
- **Configurable Automatic AI Model Fallback System**: When the primary model encounters recoverable failures (HTTP 503 overload, HTTP 429 rate limits, 502/504 gateways, or network timeouts), CCai automatically retries and falls back through configured backup models—including across different AI providers—without interrupting normal Discord conversations.

This version intentionally has no image generation, music, voice, payments, dashboard, or permanent message storage.

## Requirements

- Node.js 24.17 or newer.
- pnpm 11.
- A Discord application and bot token.
- An API key for a text-model provider (e.g. OpenAI, Groq, OpenRouter, Ollama, etc.).

## 1. Create the Discord bot

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Open **Bot**, create the bot user, and copy its token.
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
   **Server Members Intent** is optional and only required for full member
   listings. If you enable it in the portal, also set
   `DISCORD_GUILD_MEMBERS_INTENT=true`; otherwise leave it disabled.
4. Under **Installation**, enable the `bot` and `applications.commands` scopes.
5. Request only these initial bot permissions:
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Embed Links
   - Attach Files
   - Read Message History
   - Manage Channels
   - Manage Roles
   - Kick Members
   - Ban Members
   - Moderate Members
   - Manage Nicknames
   - Manage Messages
6. Install the bot into a private test server.

Do not grant Administrator. Discord's current intent rules are documented in the [Gateway documentation](https://docs.discord.com/developers/events/gateway).

## 2. Configure the project

Install dependencies and create the local environment file:

```powershell
pnpm install
Copy-Item .env.example .env
```

Fill in at least:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_GUILD_ID=your-test-server-id
AI_API_KEY=your-provider-key
# Prefer immutable role IDs. Exact role names also work.
AI_ADMIN_ROLES=123456789012345678,Senior Admin
```

### Authorized server management

Only the server owner and members with a role listed in `AI_ADMIN_ROLES` can
use management. The value accepts comma-separated role IDs or exact role
names, so one role can authorize any number of administrators and multiple
roles can be listed. Role IDs are safer because renaming a role does not alter
access.

```text
cc manage create a text channel named announcements
cc manage kick @user for repeated spam
cc manage add the Helpers role to @user
cc manage list channels
cc manage confirm
cc manage cancel
```

Read-only plans run immediately. Any plan that changes Discord is previewed
and stored for five minutes; `cc manage confirm` executes that exact plan.
The equivalent slash commands are `/manage request`, `/manage confirm`, and
`/manage cancel`. Discord still enforces the bot role's permission and role
hierarchy, so place the bot role above roles and members it must manage.

### Free Web Search Setup

Web search works out of the box using **DuckDuckGo with NO API KEY required**:

```dotenv
# Default zero-configuration free search
SEARCH_PROVIDER=duckduckgo
SEARCH_MAX_RESULTS=5
```

You can also use other free/freemium search providers:

- **DuckDuckGo (`SEARCH_PROVIDER=duckduckgo`)**: 100% free, no registration or API key required.
- **Tavily (`SEARCH_PROVIDER=tavily` or `TAVILY_API_KEY=...`)**: 1,000 free searches/month at [tavily.com](https://tavily.com). Specifically optimized for LLMs and AI agent context.
- **Brave Search (`SEARCH_PROVIDER=brave` or `BRAVE_API_KEY=...`)**: Free monthly allowance at [brave.com/search/api](https://brave.com/search/api/).
- **SearXNG (`SEARCH_PROVIDER=searxng` and `SEARXNG_BASE_URL=...`)**: Connect to a free self-hosted or public SearXNG instance.

### Optional Persistent Memory (Aiven PostgreSQL)

To allow users and servers to teach the bot abbreviations, definitions, and facts, connect an Aiven PostgreSQL database:

```dotenv
# Aiven PostgreSQL Service URI
DATABASE_URL=postgres://avnadmin:YOUR_PASSWORD@YOUR_HOST.aivencloud.com:PORT/defaultdb?sslmode=require
MEMORY_ENABLED=true
```

When configured, the bot automatically creates the `memories` table on startup and supports:
- `cc remember <key> = <value>` (Personal) or `cc remember [server] <key> = <value>` (Server-wide)
- `cc memory` or `/memory` to view saved abbreviations and facts
- `cc forget <key>` or `/forget` to delete memories
- Automatic injection of abbreviations and custom terms into AI prompts!

### AI Provider Models

#### Native Google Gemini & Gemma API (`google-native`)

To use Google's official Gemini/Gemma API directly:

```dotenv
AI_API_STYLE=google-native
AI_MODEL=gemma-4-31b-it
AI_API_KEY=your_google_api_key
```

Supported models include:
- **Gemma models**: `gemma-4-31b-it`, `gemma-2-27b-it`, `gemma-2-9b-it`, etc. Gemma models are automatically handled with appropriate prompt packaging (system instructions are cleanly prepended to the user turn, avoiding Google's 400 rejection of `system_instruction` on Gemma models, and proactive DuckDuckGo search provides live search context without requiring tool declarations).
- **Gemini models**: `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`, etc. Gemini models natively support `systemInstruction`, image multimodal inputs (`inlineData`), and function calling for live `web_search`.

The default endpoint is `https://generativelanguage.googleapis.com/v1beta`. You can optionally override it with `AI_BASE_URL` if routing through a proxy.

#### OpenAI Responses API (`responses`)

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_STYLE=responses
AI_MODEL=gpt-5-mini
AI_API_KEY=your_openai_api_key
```

#### OpenAI-Compatible Chat Completions (`chat-completions`)

To use a provider that exposes an OpenAI-compatible Chat Completions endpoint (e.g. OpenRouter, Groq, Ollama, DeepSeek):

```dotenv
AI_BASE_URL=https://provider.example/v1
AI_API_STYLE=chat-completions
AI_CHAT_TOKEN_FIELD=auto
AI_MODEL=provider-model-name
AI_API_KEY=provider-key
```

When using `chat-completions` or `google-native` (Gemini), the bot equips the AI model with a `web_search` tool function. When questions require live data, the AI searches DuckDuckGo / Tavily in real time, reads the snippets, and generates a grounded response with clickable citation links. Proactive DuckDuckGo search also injects live context for models without function calling.

### Google's Recommended API Retry and Backoff Strategy

Google's Gemini and Gemma API documentation explains:
> *503 errors are unrelated to your quota and indicate our services are temporarily overloaded and can’t service your request.*

Google recommends implementing **automatic retries with backoff**. CCai implements this exact strategy natively for Google's API:

```dotenv
# Enable automatic retries on temporary HTTP 503 overload
AI_RETRY_ENABLED=true

# Total attempts: 1 initial request + up to 2 retries (default: 3)
AI_RETRY_MAX_ATTEMPTS=3

# Initial delay for first retry attempt in milliseconds (default: 1000ms ~ 1s)
AI_RETRY_INITIAL_DELAY_MS=1000

# Maximum backoff delay cap in milliseconds (default: 4000ms ~ 4s)
AI_RETRY_MAX_DELAY_MS=4000

# Per-request timeout in milliseconds (default: 15000ms ~ 15s)
AI_REQUEST_TIMEOUT_MS=15000
```

#### Expected Behavior

When Google returns HTTP 503 (or `UNAVAILABLE` status), CCai automatically retries with exponential backoff and jitter:

```text
Request 1 → Google returns HTTP 503
Wait approximately 1 second (~1000ms with jitter)

Request 2 → Google returns HTTP 503
Wait approximately 2 seconds (~2000ms with jitter)

Request 3 → Google returns HTTP 200
Return the successful response to Discord
```

- **Exponential Backoff with Jitter**: Delay increases exponentially (`initialDelay * 2^retryIndex`) capped by `AI_RETRY_MAX_DELAY_MS`. Proportional jitter (±20%) desynchronizes concurrent requests so bursts do not hammer Google's servers in lockstep.
- **Server Retry Hints**: Honors server-provided `Retry-After` HTTP headers or Google RPC `RetryInfo` metadata (e.g. `retryDelay: "2s"`), bounded by configured safety limits.
- **No Side Effects**: Retries operate at the API request level. They never duplicate Discord messages, repeat previously executed tool calls, or trigger premature server-management actions.
- **Context Preservation**: Full conversation history, Discord reply context, PostgreSQL memories, and system instructions are preserved across all retry attempts.
- **Credential-Safe Logging**: Logs retry attempts, HTTP status codes, and delays without exposing API keys, prompt content, or user data.
- **Fallback Integration**: After the Google retry budget is exhausted, CCai switches to an eligible backup model without repeating that budget. Errors outside this retry strategy keep the existing fallback behavior: HTTP 429 switches immediately, while HTTP 502 can retry before switching.

### Automatic AI Model Fallbacks

When your primary AI model fails due to recoverable provider issues (e.g., Google servers returning HTTP 503 overload on `gemma-4-31b-it`, HTTP 429 rate limits, HTTP 502/504 gateway failures, or network timeouts), CCai automatically retries transient errors with exponential backoff and cascades through configured fallback models in sequence.

Normal conversation is never interrupted, and Discord is never spammed with intermediate errors.

#### 1. Basic Same-Provider Fallback

If you run Google Gemma as your primary model, you can set fast Gemini models as automatic backups using your existing `AI_API_KEY`:

```dotenv
AI_API_STYLE=google-native
AI_MODEL=gemma-4-31b-it

# Automatic fallback configuration
AI_FALLBACK_ENABLED=true
AI_FALLBACK_MODELS=gemini-2.5-flash-lite,gemini-2.5-flash
AI_FALLBACK_MAX_RETRIES=2
AI_FALLBACK_TIMEOUT_MS=15000
```

Execution flow:
1. CCai sends the request to primary model `gemma-4-31b-it`.
2. If Google returns HTTP 503 (server overloaded), CCai attempts up to `AI_FALLBACK_MAX_RETRIES` with exponential backoff.
3. If Gemma remains unavailable, CCai automatically switches to `gemini-2.5-flash-lite`.
4. If that fails, it switches to `gemini-2.5-flash`.
5. The user receives a normal response in Discord without noticing the provider overload.
6. The next independent question starts with `gemma-4-31b-it` again. The primary model is never permanently swapped away.

#### 2. Cross-Provider Fallback

Fallback models are not limited to the primary provider. You can configure backup models from completely different AI providers (e.g. Google Gemma primary → Google Gemini backup 1 → Groq Llama backup 2 → OpenAI backup 3):

```dotenv
AI_API_STYLE=google-native
AI_MODEL=gemma-4-31b-it
AI_API_KEY=your_google_api_key

AI_FALLBACK_ENABLED=true
AI_FALLBACK_MODELS=gemini-2.5-flash-lite,llama-3.3-70b-versatile
AI_FALLBACK_MAX_RETRIES=1
AI_FALLBACK_TIMEOUT_MS=15000

# Distinct credentials and endpoint for fallback model #2 (Groq)
AI_FALLBACK_2_API_STYLE=chat-completions
AI_FALLBACK_2_BASE_URL=https://api.groq.com/openai/v1
AI_FALLBACK_2_API_KEY=gsk_your_groq_api_key
```

Or configure all backup models as a structured JSON array via `AI_FALLBACK_CONFIG`:

```dotenv
AI_FALLBACK_CONFIG=[{"model":"gemini-2.5-flash-lite"},{"model":"llama-3.3-70b-versatile","style":"chat-completions","baseUrl":"https://api.groq.com/openai/v1","apiKey":"gsk_..."}]
```

#### 3. Diagnostic Logging

CCai outputs clear diagnostic logs detailing every step without ever logging API keys, credentials, or user message content:

```text
Primary model gemma-4-31b-it failed: HTTP 503
Retrying primary model: attempt 2
Primary model gemma-4-31b-it failed: HTTP 503
Switching to fallback model: gemini-2.5-flash-lite
Fallback model succeeded
```

#### 4. Safeguards & Context Preservation

- **Full Context & Memory Preservation**: Fallback models receive the exact same question, referenced message reply context, multi-turn history, memories, and web search results.
- **Model Capability Differences**: Differences between text-only models (like Gemma) and multimodal/tool-calling models (like Gemini and OpenAI) are handled automatically. Gemma receives prepended system instructions; Gemini receives native system instructions and tools.
- **Tool & Server-Management Safety**: Non-idempotent server-management operations are never executed prematurely or duplicated. Planning returns JSON only, and mutations still require explicit administrator confirmation (`cc manage confirm`).
- **History Isolation**: Only the final successful response is added to conversation history. Failed attempts and intermediate retries are never stored.
- **Circuit Breaker**: Optional configurable circuit breaker (`AI_FALLBACK_CIRCUIT_BREAKER_THRESHOLD=3`, `AI_FALLBACK_CIRCUIT_BREAKER_COOLDOWN_MS=60000`) skips the primary model temporarily when multiple consecutive failures occur. Disabled by default (`0`), so every request starts with the primary model.

## 3. Register slash commands

For development, keep `DISCORD_GUILD_ID` set so changes appear immediately:

```powershell
pnpm register-commands
```

When ready for production, remove `DISCORD_GUILD_ID` and run the command again to register global commands. Registration replaces the complete command list at that scope.

## 4. Run the bot

Development with automatic restarts:

```powershell
pnpm dev
```

Production build:

```powershell
pnpm build
pnpm start
```

Try:

```text
cc search latest tech news
cc what are the latest space telescope discoveries?
cc explain why
cc clear
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `BOT_PREFIX` | `cc` | Normal-message trigger |
| `AI_API_STYLE` | `responses` | AI provider protocol: `google-native`, `responses`, `chat-completions` |
| `AI_MODEL` | `gpt-5-mini` | AI model name (e.g. `gemma-4-31b-it`, `gemini-2.5-flash`, `gpt-5-mini`) |
| `AI_BASE_URL` | auto | Provider base URL (defaults according to `AI_API_STYLE`) |
| `SEARCH_PROVIDER` | `duckduckgo` | Search provider: `duckduckgo`, `auto`, `tavily`, `brave`, `searxng` |
| `SEARCH_MAX_RESULTS` | `5` | Maximum number of search results passed to AI |
| `SEARCH_TIMEOUT_MS` | `10000` | Search request timeout in ms |
| `TAVILY_API_KEY` | blank | Optional API key for Tavily AI search (1k free/mo) |
| `BRAVE_API_KEY` | blank | Optional API key for Brave Search API |
| `SEARXNG_BASE_URL` | blank | Optional SearXNG instance URL |
| `CHAT_HISTORY_ENABLED` | `true` | Enable or disable multi-turn conversation history |
| `REPLY_CONTEXT_ENABLED` | `true` | Enable or disable universal Discord reply context awareness |
| `MAX_REPLY_CONTEXT_CHARS` | `4000` | Maximum character limit for referenced reply context |
| `MAX_REPLY_CHAIN_DEPTH` | `3` | Maximum number of chained reply levels to resolve |
| `MAX_HISTORY_CHARS` | `12000` | Maximum character limit for retained conversation history |
| `HISTORY_TTL_MINUTES` | `30` | Context expiry after the last successful answer |
| `COOLDOWN_SECONDS` | `3` | Per-user delay between AI requests |
| `MAX_CONCURRENT_REQUESTS` | `4` | Global cap on simultaneous provider calls |
| `ALLOWED_CHANNEL_IDS` | blank | Optional comma-separated channel allowlist |
| `AI_ADMIN_ROLES` | blank | Comma-separated role IDs or exact names authorized for server management; server owner is always allowed |
| `DISCORD_GUILD_MEMBERS_INTENT` | `false` | Request the privileged Server Members gateway intent; required only for full member listings and must also be enabled in the Developer Portal |
| `AI_TIMEOUT_MS` | `45000` | Provider request timeout |
| `AI_MAX_OUTPUT_TOKENS` | `800` | Provider output cap |
| `AI_REASONING_EFFORT` | `off` | Optional `none`, `low`, `medium`, or `high` reasoning mode |
| `AI_CHAT_TOKEN_FIELD` | `auto` | Token-limit field for chat-completions providers |
| `AI_WEB_SEARCH_ENABLED` | `true` | Allow AI to search the live web |
| `AI_FALLBACK_ENABLED` | `true` | Enable or disable automatic model fallback system |
| `AI_FALLBACK_MODELS` | blank | Comma-separated fallback model names (e.g. `gemini-2.5-flash-lite,gemini-2.5-flash`) |
| `AI_FALLBACK_MAX_RETRIES` | `1` | Max transient retries per model before moving to next fallback |
| `AI_FALLBACK_TIMEOUT_MS` | `15000` | Per-fallback model request timeout in ms |
| `AI_FALLBACK_CIRCUIT_BREAKER_THRESHOLD` | `0` | Consecutive failures before skipping primary (0 = disabled) |
| `AI_FALLBACK_CIRCUIT_BREAKER_COOLDOWN_MS` | `60000` | Cooldown period in ms while circuit breaker is open |
| `AI_FALLBACK_CONFIG` | blank | Optional JSON array of fallback model configurations |
| `AI_FALLBACK_API_KEY` | blank | Optional default API key for fallback models |
| `AI_FALLBACK_BASE_URL` | blank | Optional default base URL for fallback models |
| `AI_FALLBACK_API_STYLE` | blank | Optional default API style for fallback models |
| `SYSTEM_PROMPT` | shown in `.env.example` | Bot personality and output rules |

Recent context lives only in process memory. It disappears when the bot restarts and automatically expires. Failed AI requests are not added to history.

Channel allowlisting applies only inside servers. DMs remain available, and threads inherit permission from an allowlisted parent channel.

## Quality checks

```powershell
pnpm check
```

This runs TypeScript checking, unit tests, and a production build.

## Deployment

Run the bot on an always-on host such as Google Cloud (Container-Optimized OS), Railway, Render, Fly.io, or a VPS. Add the environment variables through the host's secret manager or `.env`; never commit `.env`.

A `Dockerfile` and `docker-compose.yml` are included for container platforms. The application does not need inbound HTTP traffic—only outbound access to Discord and the selected AI provider.

### Published Docker image

The [Publish Docker image workflow](.github/workflows/docker-release.yml) publishes
to `ghcr.io/jahruz67/ccai` for `linux/amd64` and `linux/arm64`. It runs only when
manually triggered; pushes, Git tags, and GitHub releases do not trigger it.

To publish a version after the workflow is on the default branch:

1. Open **Actions → Publish Docker image → Run workflow**.
2. Select the branch containing the code to publish. No version input is needed.
3. Leave **Also update the latest tag** enabled for the default deployment image,
   or disable it for a preview release.
4. Run the workflow. It builds the existing `Dockerfile` and pushes an automatic
   tag, plus `latest` when enabled, using `GITHUB_TOKEN`; no registry secrets are
   required.

Each run gets a tag such as `build-42-1`, using the workflow run number and attempt
number. Reruns get a new attempt number. The published image reference appears in
the workflow summary. These image tags do not create Git tags or GitHub releases.

After the first publish, make the `ccai` container package **public** in its GitHub
package settings so users can pull it without logging in. If the package already
exists, ensure this repository has Actions write access to it. Forks publish to
`ghcr.io/<owner>/<repository>` with the owner and repository names lowercased.

#### Run a published image with Compose

Install Docker with the Compose plugin. Download
[`docker-compose.example.yml`](docker-compose.example.yml) and
[`.env.example`](.env.example) into an empty directory, then rename them:

```bash
cp docker-compose.example.yml compose.yaml
cp .env.example .env
```

Edit `.env` with your Discord credentials and AI provider settings as described
above. Set `DATABASE_URL` to an accessible PostgreSQL database, or leave it empty
to run without persistent memory. The example runs only the bot. To pin a release
instead of following `latest`, add this to `.env` (replace the tag with a published
version; change the image path when using a fork):

```dotenv
CCAI_IMAGE=ghcr.io/jahruz67/ccai:build-42-1
```

```bash
docker compose pull
# Register slash commands on initial setup and when their definitions change.
docker compose run --rm ccai node dist/register-commands.js
docker compose up -d
docker compose logs -f ccai
```

Registration uses `DISCORD_APPLICATION_ID` and `DISCORD_TOKEN`; setting
`DISCORD_GUILD_ID` targets that server, while leaving it empty registers globally.
To update, change `CCAI_IMAGE` if pinned, then run `docker compose pull` and
`docker compose up -d` again. The existing `docker-compose.yml` remains available
for building from source and using its optional local PostgreSQL service.

### Docker & Google Cloud Container-Optimized OS (COS)

To deploy or update an existing instance on Google Cloud Container-Optimized OS (or any Docker host) without losing PostgreSQL data or reinstalling:

#### 1. Rebuild and Restart with Docker Compose

```bash
# Pull latest code
git pull origin main

# Build the new image and recreate the container (zero downtime / seamless reload)
docker compose up -d --build

# Inspect logs to verify startup and fallback configuration
docker compose logs -f ccai
```

The database volume (`postgres_data`) and local `.env` credentials are automatically preserved.

#### 2. Standalone Docker Update (Without Compose)

If your Container-Optimized OS VM runs the container standalone:

```bash
# Build the updated image
docker build -t ccai:latest .

# Stop and replace only the bot container (preserves existing volumes and .env)
docker stop ccai-bot
docker rm ccai-bot
docker run -d \
  --name ccai-bot \
  --restart unless-stopped \
  --env-file .env \
  ccai:latest

# Check logs
docker logs -f ccai-bot
```

### Discloud ZIP

Rebuild the app and create `discloud-deploy.zip` with:

```powershell
pnpm deploy:zip
```

The default archive does not contain `.env`; configure secrets through the hosting provider. If a private manual upload specifically requires the local `.env`, use `pnpm deploy:zip:with-env`. The resulting ZIP is ignored by Git and must never be committed or shared publicly.
