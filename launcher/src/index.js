// Tin Tanks launcher — a Cloudflare Worker that fronts the gameye-rooms
// matchmaker for browsers (quick match + lobbies) and can also run in a simple
// "direct" mode that finds-or-starts a Gameye session itself.
//
//   MODE=matchmaker  (default when MM_URL is set): the page talks to the
//                    matchmaker through the same-origin /mm/* proxy; the
//                    Gameye token lives in the matchmaker, not here.
//   MODE=direct      the page calls /api/play; needs GAMEYE_API_TOKEN here.
import { pickSession, joinUrl, countRunning } from './matchmaking.js';

const MM_PROXY_ALLOW = /^(meta|regions|tickets|queue(\/[A-Za-z0-9~_-]+)?|lobbies|lobbies\/join|lobbies\/[0-9a-f]{64}\/start|rooms\/[0-9a-f]{64}(\/leave)?)$/;

const PAGE = (cfg) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tin Tanks — play</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#5f8a3c,#1c2a12);font-family:'Trebuchet MS',Segoe UI,Helvetica,Arial,sans-serif;color:#1d1a14}
  .card{background:#f4e9cf;border:4px solid #1d1a14;border-radius:14px;padding:26px 32px;width:min(480px,92vw);box-shadow:8px 8px 0 rgba(0,0,0,.35);text-align:center}
  h1{margin:0;font:64px Impact,'Arial Black',sans-serif;letter-spacing:3px;color:#9b3b2e;text-shadow:3px 3px 0 #1d1a14;line-height:.95}
  p{color:#5a5040;font-size:15px;margin:8px 0 14px}
  label{display:block;text-align:left;font-size:13px;font-weight:bold;margin:10px 0 4px}
  input{width:100%;box-sizing:border-box;font:18px inherit;padding:9px 12px;border:3px solid #1d1a14;border-radius:8px;background:#fff}
  button{width:100%;font:26px Impact,'Arial Black',sans-serif;letter-spacing:2px;padding:9px;border:3px solid #1d1a14;border-radius:8px;background:#6b7c3a;color:#fff;cursor:pointer;box-shadow:4px 4px 0 #1d1a14;margin-top:10px}
  button.alt{background:#c9a86a;color:#1d1a14;font-size:20px}
  button:disabled{opacity:.6;cursor:default}
  .row{display:flex;gap:10px}.row>*{flex:1}
  #msg{min-height:24px;margin-top:12px;font-weight:bold;color:#9b3b2e}
  #room{display:none;margin-top:10px;background:#fff8e6;border:3px solid #1d1a14;border-radius:10px;padding:10px;text-align:left;font-size:14px}
  #code{font:28px Impact,'Arial Black',sans-serif;letter-spacing:4px;color:#9b3b2e;text-align:center;margin:4px 0}
  .bar{height:10px;background:#1d1a14;border-radius:5px;overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:#6fae2b;width:0;transition:width .3s}
  small{display:block;margin-top:12px;color:#8a7f6a;font-size:11px}
  kbd{padding:0 5px;border:2px solid #1d1a14;border-radius:4px;background:#fff;font:bold 12px inherit}
</style></head><body><div class="card">
<h1>TIN TANKS</h1>
<p>A cartoon WW2 tank scrap for four, hosted on Gameye. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>SPACE</kbd> fire. First to ${cfg.killLimit} kills.</p>
<label for="name">Call sign</label><input id="name" maxlength="16" placeholder="e.g. Sarge" autocomplete="off">
<button id="quick">FIND A GAME</button>
<div class="row"><button id="create" class="alt">CREATE LOBBY</button><button id="join" class="alt">JOIN CODE</button></div>
<input id="joincode" placeholder="Lobby code, e.g. EU-CENTRAL-1-7K3F2" style="display:none;margin-top:8px;text-transform:uppercase">
<div id="msg"></div>
<div id="room"><div id="code"></div><div id="roster"></div><div class="bar"><i id="fill"></i></div><button id="start" style="display:none">START MATCH</button><button id="leave" class="alt" style="font-size:16px">LEAVE</button></div>
<small>Matches run on Gameye in the region nearest you. The game itself opens on a plain http:// link to the server, so the browser will call it "not secure"; that is expected.</small>
</div>
<script>
const CFG=${JSON.stringify({ tenantId: cfg.tenantId, playlist: cfg.playlist, capacity: cfg.capacity })};
const $=(id)=>document.getElementById(id);
const name=$('name'),msg=$('msg'),room=$('room');
try{name.value=localStorage.getItem('tin-tanks-name')||''}catch{}
let ticket=null,membershipId=null,roomId=null,queueId=null,polling=null,busy=false;
const api=async(path,opts={})=>{const r=await fetch('/mm/'+path,{headers:{'content-type':'application/json'},...opts});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||('HTTP '+r.status));return d};
const callSign=()=>{const n=name.value.trim()||'Sarge';try{localStorage.setItem('tin-tanks-name',n)}catch{};return n};
const setBusy=(b)=>{busy=b;for(const id of['quick','create','join'])$(id).disabled=b};
async function getTicket(){if(!ticket){const t=await api('tickets',{method:'POST',body:JSON.stringify({tenantId:CFG.tenantId})});ticket=t.ticket;myPlayerId=t.playerId}return ticket}
function showRoom(snap){room.style.display='block';$('code').textContent=snap.joinCode||'';const n=snap.members.length;$('roster').textContent=(snap.kind==='lobby'?'Lobby':'Match')+' · '+n+'/'+snap.capacity+' tanks · '+snap.region+' · '+snap.state;$('fill').style.width=Math.round(100*n/snap.capacity)+'%';$('start').style.display=(snap.kind==='lobby'&&snap.state!=='live'&&isHost(snap))?'block':'none'}
let myPlayerId=null;function isHost(s){return s.hostId&&s.hostId===myPlayerId}
function stop(){clearInterval(polling);polling=null}
async function followRoom(id){roomId=id;stop();polling=setInterval(async()=>{try{const s=await api('rooms/'+roomId+'?ticket='+encodeURIComponent(ticket));showRoom(s);
  if(s.state==='closed'){stop();msg.textContent='Room closed'+(s.closedReason?': '+s.closedReason:'')+'.';room.style.display='none';setBusy(false);return}
  if(s.state==='live'&&s.server&&s.playerToken){stop();const port=s.server.ports.game||Object.values(s.server.ports)[0];msg.textContent='Server ready, rolling out…';location.href='http://'+s.server.host+':'+port+'/?token='+encodeURIComponent(s.playerToken)+'&name='+encodeURIComponent(callSign())}
  else if(s.state==='allocating'||s.state==='starting')msg.textContent='Starting your server on Gameye…';
  else if(s.kind==='lobby')msg.textContent=isHost(s)?'Share the code. Start when ready.':'Waiting for the host to start…';
  else msg.textContent='Waiting for players… '+s.members.length+'/'+s.capacity;
 }catch(e){msg.textContent=e.message}},1500)}
async function followQueue(q){queueId=q.queueId;roomId=q.roomId;stop();polling=setInterval(async()=>{try{const s=await api('queue/'+encodeURIComponent(queueId));if(s.roomId&&s.roomId!==roomId){roomId=s.roomId}if(s.state==='matched'||roomId){followRoom(roomId)}else msg.textContent='Looking for a match…'}catch(e){msg.textContent=e.message;stop();setBusy(false)}},1500)}
$('quick').onclick=async()=>{if(busy)return;setBusy(true);msg.textContent='Getting a ticket…';try{const t=await getTicket();const q=await api('queue',{method:'POST',body:JSON.stringify({ticket:t,playlist:CFG.playlist})});msg.textContent='Queued in '+q.region+'…';followQueue(q)}catch(e){msg.textContent=e.message;setBusy(false)}};
$('create').onclick=async()=>{if(busy)return;setBusy(true);try{const t=await getTicket();const l=await api('lobbies',{method:'POST',body:JSON.stringify({ticket:t,playlist:CFG.playlist,visibility:'private'})});membershipId=l.membershipId;msg.textContent='Lobby created. Share the code.';followRoom(l.roomId)}catch(e){msg.textContent=e.message;setBusy(false)}};
$('join').onclick=async()=>{const box=$('joincode');if(box.style.display==='none'){box.style.display='block';box.focus();return}const code=box.value.trim().toUpperCase();if(!code)return;if(busy)return;setBusy(true);try{const t=await getTicket();const l=await api('lobbies/join',{method:'POST',body:JSON.stringify({ticket:t,joinCode:code})});membershipId=l.membershipId;followRoom(l.roomId)}catch(e){msg.textContent=e.message;setBusy(false)}};
$('start').onclick=async()=>{try{await api('lobbies/'+roomId+'/start',{method:'POST',body:JSON.stringify({ticket,membershipId})});msg.textContent='Starting…'}catch(e){msg.textContent=e.message}};
$('leave').onclick=async()=>{stop();try{if(queueId)await api('queue/'+encodeURIComponent(queueId),{method:'DELETE'});if(roomId)await api('rooms/'+roomId+'/leave',{method:'POST',body:JSON.stringify({ticket,membershipId})})}catch{}room.style.display='none';msg.textContent='';queueId=roomId=membershipId=null;setBusy(false)};
(async()=>{try{await getTicket()}catch(e){msg.textContent='Matchmaker unavailable: '+e.message}})();
</script></body></html>`;

// ---------------------------------------------------------------- direct mode (fallback)
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
  const existing = pickSession(sessions, { image: env.GAMEYE_IMAGE, maxPlayers, tag: env.GAMEYE_TAG });
  if (existing) return { url: joinUrl(existing), fresh: false, session: existing.id };
  if (countRunning(sessions, env.GAMEYE_IMAGE, env.GAMEYE_TAG) >= Number(env.MAX_SESSIONS || 2)) {
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

// ---------------------------------------------------------------- matchmaker proxy
async function proxyMatchmaker(request, env, rest) {
  const [path, query] = rest.split('?');
  if (!MM_PROXY_ALLOW.test(path)) return json({ error: 'not_allowed' }, 404);
  const target = `${env.MM_URL.replace(/\/+$/, '')}/v1/${path}${query ? `?${query}` : ''}`;
  const init = { method: request.method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.text();
  const res = await fetch(target, init);
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mode = env.MODE || (env.MM_URL ? 'matchmaker' : 'direct');
    try {
      if (mode === 'matchmaker') {
        if (url.pathname.startsWith('/mm/')) return proxyMatchmaker(request, env, url.pathname.slice(4) + url.search);
        if (url.pathname === '/') {
          return new Response(PAGE({ tenantId: env.MM_TENANT, playlist: env.MM_PLAYLIST, capacity: Number(env.MAX_PLAYERS || 4), killLimit: Number(env.KILL_LIMIT || 10) }), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return new Response('not found', { status: 404 });
      }
      if (!env.GAMEYE_API_TOKEN) return json({ error: 'GAMEYE_API_TOKEN secret is not set on the Worker' }, 500);
      if (url.pathname === '/api/status') {
        const sessions = await listSessions(env);
        return json({ maxPlayers: Number(env.MAX_PLAYERS || 4), sessions: sessions.filter((s) => s.status === 'running').map((s) => ({ id: s.id, location: s.location, players: Number(s.playerCount ?? 0) })) });
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
      return new Response('Direct mode: POST /api/play or GET /play', { status: 404 });
    } catch (err) {
      return json({ error: `Launcher error: ${err.message}` }, 502);
    }
  },
};
