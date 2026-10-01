# CC Discord Bot

> **Website:** A responsive product site lives in [`site/`](./site). Push changes on `main` to publish it through the included GitHub Pages workflow.

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
- OpenAI Responses API support and a generic chat-completions mode with AI tool calling.

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

The default model connection uses OpenAI's Responses API:

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_STYLE=responses
AI_MODEL=gpt-5-mini
```

To use a provider that exposes an OpenAI-compatible Chat Completions endpoint (e.g. OpenRouter, Groq, Ollama, DeepSeek):

```dotenv
AI_BASE_URL=https://provider.example/v1
AI_API_STYLE=chat-completions
AI_CHAT_TOKEN_FIELD=auto
AI_MODEL=provider-model-name
AI_API_KEY=provider-key
```

When using `chat-completions`, the bot equips the AI model with a `web_search` tool call function. When questions require live data, the AI searches DuckDuckGo / Tavily in real time, reads the snippets, and generates a grounded response with clickable citation links.

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
| `SEARCH_PROVIDER` | `duckduckgo` | Search provider: `duckduckgo`, `auto`, `tavily`, `brave`, `searxng` |
| `SEARCH_MAX_RESULTS` | `5` | Maximum number of search results passed to AI |
| `SEARCH_TIMEOUT_MS` | `10000` | Search request timeout in ms |
| `TAVILY_API_KEY` | blank | Optional API key for Tavily AI search (1k free/mo) |
| `BRAVE_API_KEY` | blank | Optional API key for Brave Search API |
| `SEARXNG_BASE_URL` | blank | Optional SearXNG instance URL |
| `CHAT_HISTORY_ENABLED` | `true` | Enable or disable multi-turn conversation history |
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
| `SYSTEM_PROMPT` | shown in `.env.example` | Bot personality and output rules |

Recent context lives only in process memory. It disappears when the bot restarts and automatically expires. Failed AI requests are not added to history.

Channel allowlisting applies only inside servers. DMs remain available, and threads inherit permission from an allowlisted parent channel.

## Quality checks

```powershell
pnpm check
```

This runs TypeScript checking, unit tests, and a production build.

## Deployment

Run the bot on an always-on host such as Railway, Render, Fly.io, or a VPS. Add the environment variables through the host's secret manager; never commit `.env`.

A `Dockerfile` is included for container platforms. The application does not need inbound HTTP traffic—only outbound access to Discord and the selected AI provider.

### Discloud ZIP

Rebuild the app and create `discloud-deploy.zip` with:

```powershell
pnpm deploy:zip
```

The default archive does not contain `.env`; configure secrets through the hosting provider. If a private manual upload specifically requires the local `.env`, use `pnpm deploy:zip:with-env`. The resulting ZIP is ignored by Git and must never be committed or shared publicly.
