// Tin Tanks game server.
//
// One process hosts one match: up to four tanks over WebSocket, plus the
// built browser client as static files on the same port so a session's
// join link is simply http://<host>:<port>/.
//
// Port resolution (first match wins):
//   --port=N argument      (Gameye forwards session "args" to the entrypoint)
//   PORT env var
//   GAMEYE_PORT_TCP_8080   when NETWORK_MODE=host (Gameye host networking)
//   8080                   default (bridge networking, see Dockerfile EXPOSE)
//
// Idle shutdown: the process exits once no player has been connected for
// IDLE_SHUTDOWN_SECONDS (or --idle=N; default 300, 0 disables). On Gameye that
// ends the session so an abandoned room stops costing money; the session ttl
// remains the backstop.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DT, SNAPSHOT_EVERY, TICK_RATE } from '@tin-tanks/shared/constants';
import { Game } from './game.js';
import { createGameyeReporter } from './gameye.js';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../../client/dist');
const CONTAINER_PORT = 8080;

const args = parseArgs(process.argv.slice(2));
const PORT = resolvePort(args);
const HOST = process.env.HOST || '0.0.0.0';
const IDLE_SHUTDOWN_SECONDS = Number(args.idle ?? process.env.IDLE_SHUTDOWN_SECONDS ?? 300);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const game = new Game();
const clients = new Map(); // ws -> { playerId, alive, gameyePlayerId }
const gameye = createGameyeReporter({ log });
const startedAt = Date.now();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      players: game.players.size,
      capacity: 4,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      tick: game.tick,
    }));
    return;
  }
  serveStatic(url.pathname, res);
});

const wss = new WebSocketServer({ server, maxPayload: 1024 });

wss.on('connection', (ws, req) => {
  const client = { playerId: null, alive: true };
  clients.set(ws, client);
  ws.on('pong', () => { client.alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && client.playerId === null) {
      const player = game.addPlayer(msg.name);
      if (!player) {
        send(ws, { t: 'full' });
        ws.close(1000, 'server full');
        return;
      }
      client.playerId = player.id;
      client.gameyePlayerId = `tank-${randomUUID()}`;
      log(`join  #${player.id} "${player.name}" from ${remoteAddress(req)} (${game.players.size}/4)`);
      gameye.playerJoined(client.gameyePlayerId);
      send(ws, { t: 'welcome', id: player.id, tickRate: TICK_RATE, roster: game.roster() });
      broadcastRoster();
      return;
    }

    if (msg.t === 'i' && client.playerId !== null) {
      game.setInput(client.playerId, msg.k | 0, msg.s | 0);
      return;
    }

    if (msg.t === 'ping') {
      send(ws, { t: 'pong', c: msg.c, s: Date.now() });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (client.playerId !== null) {
      const p = game.players.get(client.playerId);
      log(`leave #${client.playerId} "${p ? p.name : '?'}" (${game.players.size - 1}/4)`);
      game.removePlayer(client.playerId);
      broadcastRoster();
      gameye.playerLeft(client.gameyePlayerId);
    }
  });

  ws.on('error', (err) => log(`socket error: ${err.message}`));
});

// Fixed-rate simulation. setInterval drift is tolerable at 30 Hz for a game this size.
let tickCount = 0;
const loop = setInterval(() => {
  game.update(DT);
  tickCount += 1;
  if (tickCount % SNAPSHOT_EVERY === 0) broadcastSnapshot();
}, 1000 / TICK_RATE);

// End the session when nobody has been around for a while.
const idleWatch = setInterval(() => {
  if (IDLE_SHUTDOWN_SECONDS > 0 && game.idleSeconds() >= IDLE_SHUTDOWN_SECONDS) {
    log(`no players for ${IDLE_SHUTDOWN_SECONDS}s, shutting down`);
    shutdown('idle');
  }
}, 5000);

// Drop dead sockets (e.g. laptop lid closed) so their tank frees a slot.
const heartbeat = setInterval(() => {
  for (const [ws, client] of clients) {
    if (!client.alive) { ws.terminate(); continue; }
    client.alive = false;
    ws.ping();
  }
}, 10_000);

function broadcastSnapshot() {
  if (clients.size === 0) {
    game.events.length = 0;
    return;
  }
  const snap = game.snapshot();
  for (const [ws, client] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    const player = client.playerId !== null ? game.players.get(client.playerId) : null;
    snap.ack = player ? player.lastSeq : 0;
    ws.send(JSON.stringify(snap));
  }
}

function broadcastRoster() {
  const msg = JSON.stringify({ t: 'roster', roster: game.roster() });
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  if (!fs.existsSync(CLIENT_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Tin Tanks server is running, but the client has not been built.\nRun `npm run build` in the repo root, or point a dev client at this server with ?server=host:port\n');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400); res.end(); return;
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(CLIENT_DIR, rel));
  if (!file.startsWith(CLIENT_DIR + path.sep)) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  });
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

function resolvePort(a) {
  if (a.port) return Number(a.port);
  if (process.env.PORT) return Number(process.env.PORT);
  if (process.env.NETWORK_MODE === 'host' && process.env[`GAMEYE_PORT_TCP_${CONTAINER_PORT}`]) {
    return Number(process.env[`GAMEYE_PORT_TCP_${CONTAINER_PORT}`]);
  }
  return CONTAINER_PORT;
}

function remoteAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
}

function log(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function shutdown(signal) {
  log(`${signal} received, shutting down`);
  clearInterval(loop);
  clearInterval(heartbeat);
  clearInterval(idleWatch);
  for (const ws of clients.keys()) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function onServerError(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Pick another with PORT=<n> npm start, or --port=<n>.`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  process.exit(1);
}
server.on('error', onServerError);
wss.on('error', onServerError);

server.listen(PORT, HOST, () => {
  log(`Tin Tanks server listening on ${HOST}:${PORT} (${TICK_RATE} Hz)`);
  log(`idle shutdown: ${IDLE_SHUTDOWN_SECONDS > 0 ? `${IDLE_SHUTDOWN_SECONDS}s` : 'disabled'}`);
  log(`client dir: ${CLIENT_DIR} ${fs.existsSync(CLIENT_DIR) ? '(found)' : '(missing, run npm run build)'}`);
  const gameyeEnv = Object.entries(process.env)
    .filter(([k]) => k.startsWith('GAMEYE_'))
    .map(([k, v]) => `${k}=${/TOKEN|SECRET|KEY|PASSWORD/i.test(k) ? '<redacted>' : v}`);
  if (gameyeEnv.length) log(`gameye env: ${gameyeEnv.join(' ')}`);
  log(`gameye player reporting: ${gameye.enabled ? `on (${gameye.apiUrl}, session ${gameye.sessionId})` : 'off (set GAMEYE_API_TOKEN)'}`);
  const ip = process.env.GAMEYE_IP || process.env.GAMEYE_HOST;
  const hostPort = process.env[`GAMEYE_PORT_TCP_${CONTAINER_PORT}`];
  if (ip && hostPort) log(`join link: http://${ip}:${hostPort}/`);
});
