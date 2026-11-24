# Setup

[Documentation](README.md) · [Configuration](configuration.md) · [Deployment](deployment.md)

## Create a Discord bot

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its bot token.
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**.
3. Install it with the `bot` and `applications.commands` scopes.
4. Grant View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files, and Read Message History.

For server management, grant the permissions for the actions you need: Manage Channels, Manage Roles, Kick Members, Ban Members, Moderate Members, Manage Nicknames, and Manage Messages. Place the bot's role above the roles and members it manages. Do not grant Administrator.

Full member listings also require **Server Members Intent** in the portal and `DISCORD_GUILD_MEMBERS_INTENT=true` in `.env`.

## Run from source

Use Node.js 24 and pnpm 11. For Docker, follow [deployment](deployment.md).

```powershell
pnpm install
Copy-Item .env.example .env
```

Set these values in `.env`:

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_GUILD_ID=your-test-server-id
AI_API_KEY=your-provider-key
AI_API_STYLE=responses
AI_MODEL=gpt-5-mini
```

Choose other provider settings in [configuration](configuration.md). Keep `.env` private.

```powershell
pnpm register-commands
pnpm dev
```

`DISCORD_GUILD_ID` registers commands in one server. Remove it and register again for global commands. Registration replaces the command list at the selected scope; repeat it when command definitions change.

For production:

```powershell
pnpm build
pnpm start
```

## Commands

| Command | Purpose |
| --- | --- |
| `cc <question>` / `/ask` | Ask a question; replies can reference another message |
| `cc search <query>` / `/search` | Search the web |
| `cc remember <key> = <value>` / `/remember` | Save a personal fact or abbreviation |
| `cc remember [server] <key> = <value>` | Save a server-wide memory |
| `cc memory` / `/memory` | View memories |
| `cc forget <key>` / `/forget` | Delete a memory |
| `cc clear` / `/clear` | Clear conversation context |
| `cc help` / `/help` | Show help |
| `cc ping` / `/ping` | Check responsiveness |

Mentions, replies to the bot, and DMs also work. Saved memories require PostgreSQL; recent conversation context expires and is lost on restart.

## Server management

Only the server owner and members with a role in `AI_ADMIN_ROLES` can use management. Configure comma-separated role IDs or exact names; IDs keep working when roles are renamed.

```text
cc manage create a text channel named announcements
cc manage list channels
cc manage confirm
cc manage cancel
```

Read-only plans run immediately. Changes are previewed and require `cc manage confirm` within five minutes. For prefix commands, the requester can also react 👍 to the plan. Slash equivalents are `/manage request`, `/manage confirm`, and `/manage cancel`.

## Development checks

`pnpm check` runs TypeScript checking, unit tests, and a production build.
