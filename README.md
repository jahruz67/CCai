# CCai

A Discord AI assistant for questions, web search, saved memories, and server management.

<a href="https://discord.com/oauth2/authorize?client_id=1539780033848283299">
  <img
    src="https://img.shields.io/badge/Add%20CCai%20to%20Discord-5865F2?style=flat-square&logo=discord&logoColor=white"
    alt="Add CCai to Discord"
    width="180"
  />
</a>

[Documentation](https://github.com/jahruz67/CCai/wiki)

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

See [setup](https://github.com/jahruz67/CCai/wiki/Setup), [configuration](https://github.com/jahruz67/CCai/wiki/Configuration), and [deployment](https://github.com/jahruz67/CCai/wiki/Deployment) for details.
