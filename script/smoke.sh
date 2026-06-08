#!/usr/bin/env bash
# Post-deploy smoke for the aiwb Cloud Run service.
#
# Why this exists: the chat_messages incident (2026-06-07) sat in prod logs for
# five deploys. It was invisible to a `severity>=ERROR` check because the app
# logs turn failures at DEFAULT severity ("Chat turn error: ..."). This smoke
# greps the LOG TEXT for the app's own failure signatures — including the
# request logger's " 500 " lines, which catch any 5xx regardless of severity —
# so a broken route can't pass a green deploy again.
#
# Usage: script/smoke.sh [freshness]   (freshness default 10m, e.g. 30m, 1h)
# Exit 0 = clean, 1 = a route failed or an error signature appeared in logs.
set -uo pipefail

PROJECT="ai-webbuilder-5091"
REGION="us-central1"
SERVICE="aiwb"
BASE="https://ai-webbuilder.com"
FRESHNESS="${1:-10m}"
CURL="$(command -v curl || echo /usr/bin/curl)"

fail=0

echo "== route smoke =="
for path in "/" "/builder" "/builder?chat=0"; do
  code="$("$CURL" -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  printf '  %-18s %s\n' "$path" "$code"
  [ "$code" = "200" ] || { echo "  !! expected 200"; fail=1; }
done

echo "== log error signatures (last $FRESHNESS) =="
# Match the app's own failure strings AND any 5xx the request logger emitted.
# These live at DEFAULT severity, so a severity>=ERROR filter would miss them.
hits="$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND (\
    textPayload:\"Chat turn error\" OR \
    textPayload:\"BOOT MIGRATION FAILED\" OR \
    textPayload:\"boot migrations: FAILED\" OR \
    textPayload:\"does not exist\" OR \
    textPayload:\" 500 in \" OR \
    textPayload:\"creation error\")" \
  --project "$PROJECT" --freshness "$FRESHNESS" \
  --limit 20 --format='value(timestamp,textPayload)' 2>/dev/null)"

if [ -n "$hits" ]; then
  echo "  !! error signatures found:"
  echo "$hits" | sed 's/^/     /'
  fail=1
else
  echo "  clean"
fi

# Confirm the live revision booted its migrations (proves boot-migrations ran).
echo "== boot migrations =="
boot="$(gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND textPayload:\"boot migrations\"" \
  --project "$PROJECT" --freshness "$FRESHNESS" --limit 1 --format='value(textPayload)' 2>/dev/null)"
echo "  ${boot:-(no boot-migration log in window — redeploy or widen freshness)}"

if [ "$fail" = 0 ]; then echo "SMOKE PASS"; else echo "SMOKE FAIL"; fi
exit "$fail"
