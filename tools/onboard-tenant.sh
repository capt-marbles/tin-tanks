#!/usr/bin/env bash
# Onboard (or re-onboard under a new id) the Tin Tanks tenant on a gameye-rooms worker.
# Tenant config cannot be edited after creation, so a new image tag means a new tenant id.
#
# Usage:
#   MM_URL=https://tin-tanks-rooms.gameye.workers.dev PLATFORM_ADMIN_TOKEN=... GAMEYE_API_TOKEN=... \
#   tools/onboard-tenant.sh <tenantId> <imageTag> [gameyeApiUrl]
set -euo pipefail
TENANT="${1:?tenantId}"; TAG="${2:?imageTag}"; API_URL="${3:-https://api.planz-development.gameye.net}"
: "${MM_URL:?}"; : "${PLATFORM_ADMIN_TOKEN:?}"; : "${GAMEYE_API_TOKEN:?}"

BODY=$(python3 - "$TENANT" "$TAG" "$API_URL" "$GAMEYE_API_TOKEN" <<'PY'
import json, sys
tenant, tag, api_url, token = sys.argv[1:5]
print(json.dumps({
  "tenantId": tenant,
  "gameyeApiToken": token,
  "config": {
    "gameImage": "tin-tanks",
    "imageVersion": tag,
    "lifecycle": "managed",
    "sessionTtl": "2h",
    "ports": {"game": "tcp/8080"},
    "lobbyEnabled": True,
    "playlists": {
      "ffa-4": {"teamsPerMatch": 4, "teamSize": 1, "minPlayersToStart": 2,
                 "fillDeadlineSec": 20, "countdownSec": 3, "backfill": "prefer"}
    },
    # GAMEYE_* is a reserved prefix in serverEnv; the server also reads TT_* aliases
    # so it can keep reporting player counts to the Gameye session API.
    "serverEnv": {"TT_GAMEYE_API_TOKEN": token, "TT_GAMEYE_API_URL": api_url}
  }
}))
PY
)
CODE=$(curl -s -o /tmp/onboard.out -w '%{http_code}' -X POST "$MM_URL/v1/tenant" \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary "$BODY")
if [ "$CODE" = "201" ]; then
  echo "✓ tenant '$TENANT' created on $MM_URL (image tin-tanks:$TAG)"
  echo "  credentials (shown once) written to: ${CRED_OUT:-/tmp/onboard.out}"
  [ -n "${CRED_OUT:-}" ] && { umask 077; cp /tmp/onboard.out "$CRED_OUT"; rm -f /tmp/onboard.out; }
else
  echo "✗ HTTP $CODE: $(cat /tmp/onboard.out)" >&2; exit 1
fi
