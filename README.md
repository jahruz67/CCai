# CCai

A Discord AI assistant for questions, web search, saved memories, and server management.

[Add to Discord](https://discord.com/oauth2/authorize?client_id=1539780033848283299) · [Documentation](docs/README.md)

![C.C. from Code Geass holding pizza](./CC-and-Pizza-Hut-from-Code-Geass.jpg)

```text
cc explain this code
cc search latest space news
cc remember BRB = Be Right Back
```

Works with messages, mentions, replies, DMs, and slash commands. Use `cc help` to see the commands.

## Self-host

You need Docker Compose, a [Discord bot](https://discord.com/developers/applications), and an AI provider key.
Enable **Message Content Intent** for your bot and invite it to your server.

1. Download [docker-compose.yml](docker-compose.yml) and [.env.example](.env.example).
2. Copy `.env.example` to `.env` and set your Discord credentials, AI key, and model settings.
3. Register commands and start the bot:

```sh
docker compose pull ccai
docker compose run --rm --no-deps ccai node dist/register-commands.js
docker compose up -d ccai
```

See [setup](docs/setup.md), [configuration](docs/configuration.md), and [deployment](docs/deployment.md) for details.
