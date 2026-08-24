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

recovery_snapshot=$(node api/dist/verify-worker-rollback.js)
docker compose exec -T queue-redis redis-cli FLUSHDB >/dev/null
node api/dist/verify-worker-rollback.js --expected-snapshot "$recovery_snapshot" >/dev/null

published_count=$(node -e 'const snapshot = JSON.parse(process.argv[1]); process.stdout.write(String(snapshot.publishedCount))' "$recovery_snapshot")
if [[ "$published_count" -gt 0 ]]; then
  redrive_from=$(node -e 'const snapshot = JSON.parse(process.argv[1]); process.stdout.write(new Date(Date.parse(snapshot.earliestPublishedAt) - 1).toISOString())' "$recovery_snapshot")
  redrive_to=$(node -e 'const snapshot = JSON.parse(process.argv[1]); process.stdout.write(new Date(Date.parse(snapshot.latestPublishedAt) + 1).toISOString())' "$recovery_snapshot")

  node api/dist/redrive-domain-events.js \
    --from "$redrive_from" \
    --to "$redrive_to" \
    --time-field publication \
    --limit 1000 \
    --dry-run >/dev/null

  while true; do
    redrive_result=$(node api/dist/redrive-domain-events.js \
      --from "$redrive_from" \
      --to "$redrive_to" \
      --time-field publication \
      --limit 1000 \
      --confirm-queue-discard)
    redriven_count=$(node -e 'const result = JSON.parse(process.argv[1]); process.stdout.write(String(result.redriven))' "$redrive_result")
    [[ "$redriven_count" -eq 0 ]] && break
  done
fi

docker compose -f compose.yml -f "$override" stop api
docker compose up -d --no-build api worker
until docker compose exec -T worker node dist/worker-health.js; do sleep 1; done
while true; do
  recovery_snapshot=$(node api/dist/verify-worker-rollback.js)
  unpublished_count=$(node -e 'const snapshot = JSON.parse(process.argv[1]); process.stdout.write(String(snapshot.unpublishedCount))' "$recovery_snapshot")
  [[ "$unpublished_count" -eq 0 ]] && break
  sleep 1
done
curl --fail --silent --show-error http://localhost:8788/health >/dev/null

echo 'Rollback verification passed: PostgreSQL recovery was retained and queue work was re-driven.'
