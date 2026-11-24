# Deployment

[Documentation](README.md) · [Setup](setup.md) · [Configuration](configuration.md)

## Docker Compose

Install Docker Engine and Compose v2. Download [docker-compose.yml](../docker-compose.yml) and [.env.example](../.env.example) into a persistent deployment directory.

For a new deployment only:

```sh
cp .env.example .env
```

Fill in your Discord credentials and AI provider settings. Leave `DATABASE_URL` empty to run without persistent memory, or provide a PostgreSQL URL. Remote databases requiring TLS also need `DATABASE_SSL=true`.

```sh
docker compose pull ccai
docker compose run --rm --no-deps ccai node dist/register-commands.js
docker compose up -d ccai
docker compose logs -f ccai
```

Register commands on initial setup and when command definitions change. `DISCORD_GUILD_ID` targets one server; leave it blank for global commands.

The [minimal Compose example](../docker-compose.example.yml) is available for a bot-only deployment. No inbound HTTP ports are needed; allow outbound connections to Discord, your AI/search providers, the database, and GHCR.

### Local PostgreSQL

To use the optional `local-db` service, set these values in `.env`. Choose a strong password, use it in both settings, and URL-encode it in `DATABASE_URL` if needed.

```dotenv
POSTGRES_USER=ccai
POSTGRES_PASSWORD=replace-with-a-strong-password
POSTGRES_DB=ccai
DATABASE_URL=postgresql://ccai:replace-with-a-strong-password@postgres:5432/ccai
DATABASE_SSL=false
MEMORY_ENABLED=true
```

Start the database and bot:

```sh
docker compose --profile local-db up -d
```

PostgreSQL data is stored in the `postgres_data` named volume.

### Updates and rollback

After **Publish Docker image** succeeds, run this in the existing deployment directory:

```sh
docker compose pull ccai && docker compose up -d --no-deps ccai
```

Only the bot container is replaced. The database keeps running; saved memories remain, while recent conversation context resets.

Keep the existing Compose project name, `.env`, database credentials, and volume. When adopting the published-image setup, replace only the deployed Compose file; add `DATABASE_SSL=true` if your remote database requires TLS. Do not overwrite an existing `.env` with the example.

Do not run `docker compose down -v` or delete the database volume. Changing the deployment directory or project name without preserving the original project name can select a different volume.

To pin or roll back, set a published image tag in `.env` and run the same update command:

```dotenv
CCAI_IMAGE=ghcr.io/jahruz67/ccai:build-42-1
```

Remove the setting to follow `latest` again.

## Published images

The [Docker workflow](../.github/workflows/docker-release.yml) checks the application and publishes `ghcr.io/jahruz67/ccai:latest` on pushes to `main`, for `linux/amd64` and `linux/arm64`. Deployment hosts pull the image without building it.

For manual publishing, use **Actions → Publish Docker image → Run workflow**. Disable **Also update the latest tag** for a preview build. Each run publishes a `build-<run>-<attempt>` tag listed in its summary.

After the first publish, make the container package public so deployments can pull without logging in. Existing packages must grant this repository Actions write access. Forks publish under their own lowercased owner and repository name.

## Google Cloud Container-Optimized OS

Use the same image and Compose commands. Provision the Compose v2 plugin if needed. Keep the deployment directory on the VM's persistent stateful disk and retain the Docker data disk and Compose project name. Node.js and pnpm are not needed on the VM.

## Discloud

Create the deployment archive from source:

```powershell
pnpm deploy:zip
```

This rebuilds the app and creates `discloud-deploy.zip` without `.env`. Configure secrets through your host. For a private manual upload that requires the local `.env`, use `pnpm deploy:zip:with-env`; never commit or publicly share that archive.
