#!/usr/bin/env node
// Practice bot: joins a Tin Tanks server, hunts the nearest enemy with A* over
// the shared map, and fires when it has a clear line of sight.
//
// Usage: node tools/bot.js [ws://host:port] [--name=Fritz]
// Handy for solo play and for soak-testing a Gameye session.

import WebSocket from 'ws';
import { INPUT, TICK_RATE, TANK_RADIUS, BULLET_RADIUS } from '@tin-tanks/shared/constants';
import { MAP } from '@tin-tanks/shared/map';
import { wrapAngle, circleHitsSolid } from '@tin-tanks/shared/physics';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'ws://localhost:8080';
const name = (args.find((a) => a.startsWith('--name=')) || '--name=Fritz').slice(7);
const RANGE = 42;
const CELL = 2;

// ---- navigation grid --------------------------------------------------------
const COLS = Math.ceil(MAP.width / CELL);
const ROWS = Math.ceil(MAP.depth / CELL);
const blocked = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = (c + 0.5) * CELL;
    const z = (r + 0.5) * CELL;
    const nearEdge = x < TANK_RADIUS || z < TANK_RADIUS || x > MAP.width - TANK_RADIUS || z > MAP.depth - TANK_RADIUS;
    blocked[r * COLS + c] = nearEdge || circleHitsSolid(x, z, TANK_RADIUS + 0.35) ? 1 : 0;
  }
}
const cellOf = (x, z) => ({ c: Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL))), r: Math.min(ROWS - 1, Math.max(0, Math.floor(z / CELL))) });
const centre = (c, r) => ({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
const isFree = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !blocked[r * COLS + c];

function nearestFree(cell) {
  if (isFree(cell.c, cell.r)) return cell;
  for (let radius = 1; radius < 6; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (isFree(cell.c + dc, cell.r + dr)) return { c: cell.c + dc, r: cell.r + dr };
      }
    }
  }
  return cell;
}

/** 8-connected A*; diagonal steps must not cut a blocked corner. */
function findPath(from, to) {
  const start = nearestFree(from);
  const goal = nearestFree(to);
  const key = (c, r) => r * COLS + c;
  const open = new Map([[key(start.c, start.r), start]]);
  const came = new Map();
  const g = new Map([[key(start.c, start.r), 0]]);
  const h = (n) => Math.hypot(n.c - goal.c, n.r - goal.r);
  const f = new Map([[key(start.c, start.r), h(start)]]);
  while (open.size) {
    let bestKey = null;
    let bestF = Infinity;
    for (const k of open.keys()) if (f.get(k) < bestF) { bestF = f.get(k); bestKey = k; }
    const cur = open.get(bestKey);
    open.delete(bestKey);
    if (cur.c === goal.c && cur.r === goal.r) {
      const path = [cur];
      let k = bestKey;
      while (came.has(k)) { k = came.get(k); path.push({ c: k % COLS, r: Math.floor(k / COLS) }); }
      return path.reverse();
    }
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = cur.c + dc;
        const nr = cur.r + dr;
        if (!isFree(nc, nr)) continue;
        if (dc && dr && (!isFree(cur.c + dc, cur.r) || !isFree(cur.c, cur.r + dr))) continue;
        const nk = key(nc, nr);
        const cost = g.get(bestKey) + (dc && dr ? Math.SQRT2 : 1);
        if (cost < (g.get(nk) ?? Infinity)) {
          came.set(nk, bestKey);
          g.set(nk, cost);
          f.set(nk, cost + h({ c: nc, r: nr }));
          open.set(nk, { c: nc, r: nr });
        }
      }
    }
  }
  return null;
}

function clearShot(from, to) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.ceil(d / 0.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (circleHitsSolid(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, BULLET_RADIUS)) return false;
  }
  return true;
}

/** Quantise a direction to the nearest of the 8 key combinations. */
function maskToward(dx, dz) {
  const a = Math.atan2(dz, dx);
  const oct = Math.round(a / (Math.PI / 4));
  const table = {
    0: INPUT.RIGHT, 1: INPUT.RIGHT | INPUT.DOWN, 2: INPUT.DOWN, 3: INPUT.DOWN | INPUT.LEFT,
    4: INPUT.LEFT, [-4]: INPUT.LEFT, [-3]: INPUT.LEFT | INPUT.UP, [-2]: INPUT.UP, [-1]: INPUT.UP | INPUT.RIGHT,
  };
  return table[oct];
}

// ---- brain ------------------------------------------------------------------
const ws = new WebSocket(url);
let myId = null;
let seq = 0;
const players = new Map();
let path = null;
let pathAt = 0;
let lastPos = { x: 0, z: 0, t: Date.now() };
let unstick = { until: 0, mask: 0 };
let wanderGoal = null;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', name }));
  console.log(`[bot ${name}] connected to ${url}`);
});
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'welcome') { myId = msg.id; console.log(`[bot ${name}] joined as #${myId}`); }
  if (msg.t === 'full') { console.log(`[bot ${name}] server full`); process.exit(1); }
  if (msg.t === 's') {
    for (const [id, x, z, a, hp, alive, kills, deaths] of msg.p) players.set(id, { x, z, a, hp, alive: !!alive, kills, deaths });
    for (const id of [...players.keys()]) if (!msg.p.some((p) => p[0] === id)) players.delete(id);
    for (const ev of msg.ev) {
      if (ev.e === 'kill' && ev.killer === myId) console.log(`[bot ${name}] scrapped #${ev.victim}`);
      if (ev.e === 'kill' && ev.victim === myId) console.log(`[bot ${name}] scrapped by #${ev.killer}`);
    }
  }
});
ws.on('close', () => { console.log(`[bot ${name}] disconnected`); process.exit(0); });
ws.on('error', (e) => { console.error(`[bot ${name}] ${e.message}`); process.exit(1); });

const randomMask = () => [INPUT.UP, INPUT.DOWN, INPUT.LEFT, INPUT.RIGHT][Math.floor(Math.random() * 4)];

function decide() {
  const me = players.get(myId);
  if (!me || !me.alive) { path = null; return 0; }
  const now = Date.now();

  if (now - lastPos.t > 600) {
    if (Math.hypot(me.x - lastPos.x, me.z - lastPos.z) < 0.4 && unstick.until < now) {
      unstick = { until: now + 600, mask: randomMask() };
      path = null;
    }
    lastPos = { x: me.x, z: me.z, t: now };
  }
  if (unstick.until > now) return unstick.mask;

  let target = null;
  let best = Infinity;
  for (const [id, p] of players) {
    if (id === myId || !p.alive) continue;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < best) { best = d; target = p; }
  }

  // Take the shot when the enemy is in range, in the open, and we can face them exactly.
  if (target && best < RANGE && clearShot(me, target)) {
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const want = Math.atan2(dz, dx);
    const oct = Math.round(want / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(wrapAngle(want - oct)) < Math.atan2(TANK_RADIUS, best)) {
      let mask = maskToward(dx, dz);
      if (Math.abs(wrapAngle(me.a - want)) < 0.1) mask |= INPUT.FIRE;
      return mask;
    }
  }

  // Otherwise navigate toward the target (or wander to a random free cell).
  let goal;
  if (target) goal = target;
  else {
    if (!wanderGoal || Math.hypot(wanderGoal.x - me.x, wanderGoal.z - me.z) < 2) {
      const cell = nearestFree({ c: Math.floor(Math.random() * COLS), r: Math.floor(Math.random() * ROWS) });
      wanderGoal = centre(cell.c, cell.r);
    }
    goal = wanderGoal;
  }
  if (!path || now - pathAt > 700) {
    path = findPath(cellOf(me.x, me.z), cellOf(goal.x, goal.z));
    pathAt = now;
  }
  if (!path || path.length === 0) return maskToward(goal.x - me.x, goal.z - me.z);
  while (path.length > 1) {
    const wp = centre(path[0].c, path[0].r);
    if (Math.hypot(wp.x - me.x, wp.z - me.z) < 1.2) path.shift(); else break;
  }
  const wp = path.length > 1 ? centre(path[0].c, path[0].r) : goal;
  return maskToward(wp.x - me.x, wp.z - me.z);
}

setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN || myId === null) return;
  seq += 1;
  ws.send(JSON.stringify({ t: 'i', s: seq, k: decide() }));
}, 1000 / TICK_RATE);
