// Pure matchmaking helpers, kept free of Worker APIs so they can be unit tested.

/** Pick the fullest running session that still has a free slot, or null. */
/** A session counts only if it runs our image (and the pinned tag, when one is set). */
export function matches(s, { image, tag }) {
  return s.image === image && s.status === 'running' && (!tag || s.tag === tag);
}

export function pickSession(sessions, { image, maxPlayers, tag }) {
  const open = sessions
    .filter((s) => matches(s, { image, tag }))
    .map((s) => ({ ...s, players: Number(s.playerCount ?? 0) }))
    .filter((s) => s.players < maxPlayers)
    .sort((a, b) => b.players - a.players || a.created - b.created);
  return open[0] || null;
}

/** Join link for a session: the first TCP host port. */
export function joinUrl(session) {
  const port = session.port?.['8080/tcp']
    ?? (Array.isArray(session.ports) ? session.ports.find((p) => p.type === 'tcp')?.host : undefined);
  if (!session.host || !port) return null;
  return `http://${session.host}:${port}/`;
}

export function countRunning(sessions, image, tag) {
  return sessions.filter((s) => matches(s, { image, tag })).length;
}

/**
 * Env for a session the launcher starts. The game server only needs to report
 * player joins and leaves, so it gets GAMEYE_SERVER_TOKEN (session:write only),
 * never the launcher's own token. Without one it runs and reports nothing.
 */
export function sessionEnv(env) {
  if (!env.GAMEYE_SERVER_TOKEN) return {};
  return { GAMEYE_API_TOKEN: env.GAMEYE_SERVER_TOKEN, GAMEYE_API_URL: env.GAMEYE_API_URL };
}

/** Escape text for an HTML page. */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
