#!/usr/bin/env bash
set -euo pipefail

: "${EVE_SPACE_PREVIOUS_API_IMAGE:?Set this to the previously deployed API image.}"
: "${EVE_SPACE_CONFIRM_QUEUE_DISCARD:?Set this to 1 to confirm queue discard in this local Compose environment.}"

if [[ "$EVE_SPACE_CONFIRM_QUEUE_DISCARD" != "1" ]]; then
  echo 'EVE_SPACE_CONFIRM_QUEUE_DISCARD must be 1.' >&2
  exit 1
fi

docker image inspect "$EVE_SPACE_PREVIOUS_API_IMAGE" >/dev/null
pnpm --filter @eve-space/api build >/dev/null

node --input-type=module <<'EOF'
import { listJobDefinitions } from './api/dist/queue/job-registry.js'

if (listJobDefinitions().some((job) => job.durability !== 'derived')) {
  throw new Error('Rollback verification requires every registered job to be derived')
}
EOF

override=$(mktemp)
cleanup() {
  rm -f "$override"
  docker compose up -d --no-build api worker
}
trap cleanup EXIT

cat >"$override" <<EOF
services:
  api:
    image: $EVE_SPACE_PREVIOUS_API_IMAGE
    build: null
    pull_policy: never
EOF

docker compose stop api worker
docker compose -f compose.yml -f "$override" up -d --no-build api
until curl --fail --silent --show-error http://localhost:8788/health >/dev/null; do sleep 1; done

# Queue Redis is dedicated to derived jobs, so this verifies the documented
# rollback condition without touching PostgreSQL's authoritative records.
docker compose exec -T queue-redis redis-cli FLUSHDB >/dev/null
docker compose -f compose.yml -f "$override" stop api
docker compose up -d --no-build api worker
until docker compose exec -T worker node dist/worker-health.js; do sleep 1; done
curl --fail --silent --show-error http://localhost:8788/health >/dev/null

echo 'Rollback verification passed: PostgreSQL remained available and queue discard was safe.'
