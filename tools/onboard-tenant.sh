#!/usr/bin/env bash
# Onboard the Tin Tanks tenant on the gameye-rooms matchmaker (native, on OVH).
# To move an existing tenant to a new image tag, patch it in place instead:
#   PATCH $MM_URL/v1/tenant/<tenantId>  {"imageVersion": "<tag>", "enableTag": true}
#
# Usage:
#   MM_URL=https://matchmaker-dev.gameye.net PLATFORM_ADMIN_TOKEN=... GAMEYE_API_TOKEN=... \
#   tools/onboard-tenant.sh <tenantId> <imageTag>
set -euo pipefail
TENANT="${1:?tenantId}"; TAG="${2:?imageTag}"
: "${MM_URL:?}"; : "${PLATFORM_ADMIN_TOKEN:?}"; : "${GAMEYE_API_TOKEN:?}"

BODY=$(python3 - "$TENANT" "$TAG" "$GAMEYE_API_TOKEN" <<'PY'
import json, sys
tenant, tag, token = sys.argv[1:4]
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
    # No Gameye credential in serverEnv: the matchmaker forwards player joins
    # and leaves to Gameye with the tenant's token.
    "serverEnv": {}
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
