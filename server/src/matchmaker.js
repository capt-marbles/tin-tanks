// Managed-server lifecycle for gameye-rooms (the Gameye matchmaker).
//
// When the matchmaker starts this server through Gameye it injects
//   MM_URL           e.g. https://<worker>/v1/server/<tenantId>
//   MM_MATCH_ID      the room id (64 hex chars)
//   MM_SERVER_TOKEN  bearer token for callbacks; also the HMAC key for player tokens
// The server then: posts ready, heartbeats every 30 s, validates each player's
// token offline on join, reports joined/left, advertises free slots for backfill
// and posts complete with the results when the round ends.
//
// Player token: `${matchId}.${playerId}.${expEpochSec}.${b64url(HMAC-SHA256(serverToken, "${matchId}.${playerId}.${expEpochSec}"))}`

import { createHmac, timingSafeEqual } from 'node:crypto';

const HEARTBEAT_SECONDS = 30;
const TIMEOUT_MS = 8000;

export function validatePlayerToken(token, matchId, serverToken, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [tokenMatch, playerId, expStr, sig] = parts;
  if (tokenMatch !== matchId) return null;
  if (!/^\d+$/.test(expStr) || Number(expStr) * 1000 < now) return null;
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(playerId)) return null;
  const expected = createHmac('sha256', serverToken).update(`${tokenMatch}.${playerId}.${expStr}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return playerId;
}

export function createMatchmakerClient({
  url = process.env.MM_URL,
  matchId = process.env.MM_MATCH_ID,
  serverToken = process.env.MM_SERVER_TOKEN,
  fetchImpl = globalThis.fetch,
  log = () => {},
  heartbeatSeconds = HEARTBEAT_SECONDS,
} = {}) {
  const enabled = Boolean(url && matchId && serverToken && fetchImpl);
  const base = (url || '').replace(/\/+$/, '');
  let heartbeat = null;

  async function post(path, body = {}) {
    if (!enabled) return null;
    const payload = JSON.stringify({ matchId, ...body });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetchImpl(`${base}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          log(`matchmaker ${path} ok`);
          return await res.json().catch(() => ({}));
        }
        const text = await res.text().catch(() => '');
        log(`matchmaker ${path} HTTP ${res.status} ${text.slice(0, 120)}${attempt === 1 ? ' (retrying)' : ''}`);
        // 4xx other than 429 will not get better with a retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
      } catch (err) {
        log(`matchmaker ${path} error: ${err.message}${attempt === 1 ? ' (retrying)' : ''}`);
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  return {
    enabled,
    matchId,
    url: base,
    validatePlayerToken: (token) => (enabled ? validatePlayerToken(token, matchId, serverToken) : null),
    async start() {
      if (!enabled) return;
      await post('/ready');
      heartbeat = setInterval(() => post('/heartbeat'), heartbeatSeconds * 1000);
      heartbeat.unref?.();
    },
    stop() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
    joined: (playerId) => post(`/players/${playerId}/joined`),
    left: (playerId) => post(`/players/${playerId}/left`),
    slots: (open) => post('/slots', { open: Math.max(0, open | 0) }),
    complete: (results) => post('/complete', { results }),
  };
}
