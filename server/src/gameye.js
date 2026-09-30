// Reports player joins and leaves to the Gameye session API so the platform's
// playerCount (and playerCount[lt] backfill filter on GET /session) stays live.
//
// Enabled only when GAMEYE_API_TOKEN is set and a session id is present in the
// container environment (GAMEYE_CONTAINER, or legacy GAMEYE_SESSION_ID).
//
// Observed API behaviour (dev environment, 2026-09-29):
//   PUT    /session/player/join   { session, players[] } -> 200 { count, players }
//   DELETE /session/player/leave  { session, players[] } -> 200 { count, players }
//   Both are idempotent. leave needs `session` even though the published schema
//   lists only `players` (without it the API answers 404).

const DEFAULT_API_URL = 'https://api.production-gameye.gameye.net';
const TIMEOUT_MS = 5000;

export function createGameyeReporter({
  apiUrl = process.env.GAMEYE_API_URL || DEFAULT_API_URL,
  token = process.env.GAMEYE_API_TOKEN,
  sessionId = process.env.GAMEYE_CONTAINER || process.env.GAMEYE_SESSION_ID,
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  const enabled = Boolean(token && sessionId && fetchImpl);
  const base = apiUrl.replace(/\/+$/, '');

  async function call(method, path, players) {
    const body = JSON.stringify({ session: sessionId, players });
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetchImpl(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          log(`gameye ${path} ${players.join(',')} -> count=${data.count}`);
          return data;
        }
        log(`gameye ${path} failed: HTTP ${res.status}${attempt === 1 ? ', retrying' : ''}`);
      } catch (err) {
        log(`gameye ${path} error: ${err.message}${attempt === 1 ? ', retrying' : ''}`);
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  return {
    enabled,
    sessionId,
    apiUrl: base,
    playerJoined: (playerId) => (enabled ? call('PUT', '/session/player/join', [playerId]) : Promise.resolve(null)),
    playerLeft: (playerId) => (enabled ? call('DELETE', '/session/player/leave', [playerId]) : Promise.resolve(null)),
  };
}
