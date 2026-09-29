#!/usr/bin/env bash
# Tell Gameye about a tag pushed to GHCR without going through a GitHub webhook
# (Gameye docs: GHCR setup, Option B — self-notification). Use this when the
# image was pushed with a PAT from a workstation, or from non-GitHub CI.
#
# Usage:
#   GAMEYE_PAYLOAD_URL=https://api.../v1/integrations/github/<org-uuid> \
#   GAMEYE_WEBHOOK_SECRET=... \
#   tools/gameye-notify.sh ghcr.io/<owner>/<name> <tag>
#
# Responses: 204 tag registered · 200 acknowledged/ignored (already known)
#            401 bad signature · 404 no application matches the repository
set -euo pipefail

IMAGE="${1:-}"; TAG="${2:-}"
[ -n "$IMAGE" ] && [ -n "$TAG" ] || { echo "usage: $0 ghcr.io/<owner>/<name> <tag>" >&2; exit 2; }
[ -n "${GAMEYE_PAYLOAD_URL:-}" ] || { echo "GAMEYE_PAYLOAD_URL is not set" >&2; exit 2; }
[ -n "${GAMEYE_WEBHOOK_SECRET:-}" ] || { echo "GAMEYE_WEBHOOK_SECRET is not set" >&2; exit 2; }

IMAGE=$(printf '%s' "$IMAGE" | tr '[:upper:]' '[:lower:]')
case "$IMAGE" in ghcr.io/*/*) ;; *) echo "image must look like ghcr.io/<owner>/<name>" >&2; exit 2 ;; esac
PATH_PART=${IMAGE#ghcr.io/}
OWNER=${PATH_PART%%/*}
NAME=${PATH_PART#*/}

BODY='{"action":"published","package":{"name":"'"$NAME"'","package_type":"CONTAINER","owner":{"login":"'"$OWNER"'"},"package_version":{"container_metadata":{"tag":{"name":"'"$TAG"'"}}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$GAMEYE_WEBHOOK_SECRET" | awk '{print $2}')

CODE=$(curl -s -o /tmp/gameye-notify.out -w '%{http_code}' -X POST "$GAMEYE_PAYLOAD_URL" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: package" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  --data-binary "$BODY")
case "$CODE" in
  204) echo "✓ $CODE Gameye registered $IMAGE:$TAG" ;;
  200) echo "✓ $CODE acknowledged (tag already registered or ignored)" ;;
  401) echo "✗ 401 bad signature — GAMEYE_WEBHOOK_SECRET does not match an active secret" >&2; exit 1 ;;
  404) echo "✗ 404 no Gameye application has Repository exactly '$IMAGE'" >&2; exit 1 ;;
  *)   echo "✗ HTTP $CODE: $(cat /tmp/gameye-notify.out)" >&2; exit 1 ;;
esac
