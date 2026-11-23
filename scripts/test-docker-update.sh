#!/usr/bin/env bash
# Runs against disposable containers and volumes, never the deployment's .env.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
export COMPOSE_PROJECT_NAME="ccai-update-test-$(date +%s)-$$"
export COMPOSE_FILE=docker-compose.yml:compose.test.yml
export COMPOSE_PROFILES=
registry_name="${COMPOSE_PROJECT_NAME}-registry"

cleanup() {
  docker compose --profile local-db logs --no-color --tail 30 || true
  # The generated project name scopes cleanup to this test's fixtures.
  docker compose --profile local-db down --volumes --remove-orphans || true
  docker rm -f "$registry_name" >/dev/null 2>&1 || true
  rm -f "$test_dir/docker-compose.yml" "$test_dir/compose.test.yml" "$test_dir/.env"
  rmdir "$test_dir"
}

cp "$repo_dir/docker-compose.yml" "$test_dir/docker-compose.yml"
cd "$test_dir"
trap cleanup EXIT

export DISCORD_TOKEN=test-token AI_API_KEY=test-key
export POSTGRES_USER=ccai POSTGRES_PASSWORD=test-password POSTGRES_DB=ccai
export DATABASE_URL='postgresql://ccai:test-password@postgres:5432/ccai?sslmode=require&application_name=ccai-update-test'
export DATABASE_SSL=false
cat > .env <<'ENV'
DISCORD_TOKEN=test-token
AI_API_KEY=test-key
TEST_ENV_PRESERVED=custom-setting
ENV
cat > compose.test.yml <<'YAML'
services:
  ccai:
    # Keep the real image running without contacting Discord or AI providers.
    command: ["node", "-e", "setInterval(() => {}, 1000)"]
YAML

docker run -d --name "$registry_name" -p 127.0.0.1::5000 registry:2 >/dev/null
registry_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5000/tcp") 0).HostPort}}' "$registry_name")"
export CCAI_IMAGE="localhost:${registry_port}/ccai:latest"
docker tag ccai:deployment-test "$CCAI_IMAGE"
docker push "$CCAI_IMAGE"
docker compose config --quiet
docker compose --profile local-db up -d --wait --wait-timeout 90

check_memory() {
  docker compose exec -T -e "TEST_PHASE=$1" ccai node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { loadConfig } from './dist/config.js';
import { MemoryStore } from './dist/memory-store.js';

const config = loadConfig();
assert.equal(config.memory.ssl, false);
assert.equal(process.env.TEST_ENV_PRESERVED, 'custom-setting');
const store = new MemoryStore(config.memory);
try {
  await store.init();
  if (process.env.TEST_PHASE === 'seed') {
    await store.remember('guild:update-test', 'deployment', 'preserved');
  }
  assert.equal((await store.get('guild:update-test', 'deployment'))?.value, 'preserved');
} finally {
  await store.close();
}
JS
}

check_memory seed
bot_before="$(docker compose ps -q ccai)"
database_id="$(docker compose --profile local-db ps -q postgres)"
database_before="$(docker inspect --format '{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}|{{json .Mounts}}' "$database_id")"

# Publish a different image under the same tag so Compose must replace the bot.
docker build --builder default --pull=false -t "$CCAI_IMAGE" - <<'DOCKERFILE'
FROM ccai:deployment-test
LABEL ccai.update-test=updated
DOCKERFILE
docker push "$CCAI_IMAGE"

# This is the exact production update command under test.
docker compose pull ccai && docker compose up -d --no-deps ccai

test "$(docker compose ps -q ccai)" != "$bot_before"
test "$(docker compose --profile local-db ps -q postgres)" = "$database_id"
test "$(docker inspect --format '{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}|{{json .Mounts}}' "$database_id")" = "$database_before"
test "$(docker inspect --format '{{index .Config.Labels "ccai.update-test"}}' "$(docker compose ps -q ccai)")" = updated
check_memory verify
echo 'Bot image updated; PostgreSQL container, uptime, volume, and saved memory preserved.'
