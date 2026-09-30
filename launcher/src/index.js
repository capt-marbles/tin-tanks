import { pickSession, joinUrl, countRunning } from './matchmaking.js';

const HTML = (status) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tin Tanks — play</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#5f8a3c,#1c2a12);font-family:'Trebuchet MS',Segoe UI,Helvetica,Arial,sans-serif;color:#1d1a14}
  .card{background:#f4e9cf;border:4px solid #1d1a14;border-radius:14px;padding:28px 34px;width:min(460px,92vw);box-shadow:8px 8px 0 rgba(0,0,0,.35);text-align:center}
  h1{margin:0;font:64px Impact,'Arial Black',sans-serif;letter-spacing:3px;color:#9b3b2e;text-shadow:3px 3px 0 #1d1a14;line-height:.95}
  p{color:#5a5040;font-size:15px}
  button{width:100%;font:28px Impact,'Arial Black',sans-serif;letter-spacing:2px;padding:10px;border:3px solid #1d1a14;border-radius:8px;background:#6b7c3a;color:#fff;cursor:pointer;box-shadow:4px 4px 0 #1d1a14;margin-top:8px}
  button:disabled{opacity:.6;cursor:default}
  #msg{min-height:22px;margin-top:12px;font-weight:bold;color:#9b3b2e}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td{padding:4px 6px;border-top:1px solid #d8c9a6}td:last-child{text-align:right}
  small{display:block;margin-top:14px;color:#8a7f6a;font-size:11px}
  kbd{padding:0 5px;border:2px solid #1d1a14;border-radius:4px;background:#fff;font:bold 12px inherit}
</style></head><body><div class="card">
<h1>TIN TANKS</h1>
<p>A cartoon WW2 tank scrap for four, hosted on Gameye. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move, <kbd>SPACE</kbd> to fire.</p>
<button id="play">FIND A GAME</button>
<div id="msg"></div>
<table id="list"><tbody>${status.sessions.map((s) => `<tr><td>${s.location} · ${s.id.slice(0, 8)}</td><td>${s.players}/${status.maxPlayers} tanks</td></tr>`).join('') || '<tr><td colspan="2">No matches running — the first player starts one.</td></tr>'}</tbody></table>
<small>The game opens on a plain http:// link straight to the game server, so your browser will call it "not secure". That is expected.</small>
</div>
<script>
const b=document.getElementById('play'),m=document.getElementById('msg');
b.onclick=async()=>{b.disabled=true;m.textContent='Looking for a match…';
  try{const r=await fetch('/api/play',{method:'POST'});const d=await r.json();
    if(!r.ok){m.textContent=d.error||'No luck, try again in a moment.';b.disabled=false;return;}
    if(d.fresh){let n=8;m.textContent='Starting a fresh server… '+n;const t=setInterval(()=>{n--;m.textContent='Starting a fresh server… '+n;if(n<=0){clearInterval(t);location.href=d.url;}},1000);}
    else{m.textContent='Match found, rolling out…';location.href=d.url;}
  }catch(e){m.textContent='Could not reach the launcher.';b.disabled=false;}};
</script></body></html>`;

async function gameye(env, path, init = {}) {
  const res = await fetch(`${env.GAMEYE_API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GAMEYE_API_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function listSessions(env) {
  const r = await gameye(env, `/session?image=${encodeURIComponent(env.GAMEYE_IMAGE)}`);
  if (!r.ok) throw new Error(`GET /session ${r.status}`);
  return Array.isArray(r.data) ? r.data : (r.data?.sessions || []);
}

async function findOrStart(env) {
  const maxPlayers = Number(env.MAX_PLAYERS || 4);
  const sessions = await listSessions(env);
  const existing = pickSession(sessions, { image: env.GAMEYE_IMAGE, maxPlayers });
  if (existing) return { url: joinUrl(existing), fresh: false, session: existing.id };

  if (countRunning(sessions, env.GAMEYE_IMAGE) >= Number(env.MAX_SESSIONS || 2)) {
    return { error: 'All matches are full right now. Try again in a minute.', status: 503 };
  }
  const id = crypto.randomUUID();
  const body = {
    id,
    location: env.GAMEYE_LOCATION,
    image: env.GAMEYE_IMAGE,
    ...(env.GAMEYE_TAG ? { version: env.GAMEYE_TAG } : {}),
    env: { GAMEYE_API_TOKEN: env.GAMEYE_API_TOKEN, GAMEYE_API_URL: env.GAMEYE_API_URL },
    labels: { launcher: 'tin-tanks' },
    restart: false,
    ttl: env.SESSION_TTL || '2h',
  };
  const r = await gameye(env, '/session', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return { error: `Gameye could not start a server (HTTP ${r.status}).`, status: 502, detail: r.data };
  const started = { ...r.data, id: r.data?.id || id, host: r.data?.host, ports: r.data?.ports, port: r.data?.port };
  const url = joinUrl(started);
  if (!url) return { error: 'Server started but no port was returned.', status: 502, detail: r.data };
  return { url, fresh: true, session: started.id };
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.GAMEYE_API_TOKEN) return json({ error: 'GAMEYE_API_TOKEN secret is not set on the Worker' }, 500);

    try {
      if (url.pathname === '/api/status') {
        const sessions = await listSessions(env);
        return json({
          maxPlayers: Number(env.MAX_PLAYERS || 4),
          sessions: sessions.filter((s) => s.status === 'running').map((s) => ({ id: s.id, location: s.location, players: Number(s.playerCount ?? 0) })),
        });
      }
      if (url.pathname === '/api/play' && request.method === 'POST') {
        const result = await findOrStart(env);
        return result.error ? json(result, result.status) : json(result);
      }
      if (url.pathname === '/play') {
        const result = await findOrStart(env);
        if (result.error) return new Response(result.error, { status: result.status });
        return Response.redirect(result.url, 302);
      }
      if (url.pathname === '/') {
        const sessions = await listSessions(env).catch(() => []);
        const status = {
          maxPlayers: Number(env.MAX_PLAYERS || 4),
          sessions: sessions.filter((s) => s.status === 'running').map((s) => ({ id: s.id, location: s.location, players: Number(s.playerCount ?? 0) })),
        };
        return new Response(HTML(status), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      return new Response('not found', { status: 404 });
    } catch (err) {
      return json({ error: `Launcher error: ${err.message}` }, 502);
    }
  },
};
