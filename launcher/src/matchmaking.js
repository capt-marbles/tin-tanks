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
