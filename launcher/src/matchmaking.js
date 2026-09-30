// Pure matchmaking helpers, kept free of Worker APIs so they can be unit tested.

/** Pick the fullest running session that still has a free slot, or null. */
export function pickSession(sessions, { image, maxPlayers }) {
  const open = sessions
    .filter((s) => s.image === image && s.status === 'running')
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

export function countRunning(sessions, image) {
  return sessions.filter((s) => s.image === image && s.status === 'running').length;
}
