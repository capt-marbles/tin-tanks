import * as THREE from 'three';
import { DT, RESPAWN_TIME, TANK_PAINT, BULLET_SPEED, MAX_PLAYERS, KILL_LIMIT, ROUND_END_SECONDS } from '@tin-tanks/shared/constants';
import { MAP } from '@tin-tanks/shared/map';
import { stepTank, angleLerp } from '@tin-tanks/shared/physics';
import { buildWorld } from './world.js';
import { buildTank, Label } from './tank.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { Net, resolveServerUrl } from './net.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { createPipeline } from './post.js';

const INTERP_DELAY = 100;   // ms: remote tanks are drawn this far behind the newest snapshot
const VIEW_HEIGHT = 32;     // world units visible top-to-bottom (before the camera tilt)
const CAM_OFFSET = new THREE.Vector3(0, 50, 34);
const SUN_OFFSET = new THREE.Vector3(-30, 70, 25);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
let graphics = 'high';
try { graphics = localStorage.getItem('tin-tanks-gfx') || 'high'; } catch { /* ignore */ }
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5f8a3c);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
const camTarget = new THREE.Vector3(MAP.width / 2, 0, MAP.depth / 2);
let shake = 0;

function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-VIEW_HEIGHT * aspect) / 2;
  camera.right = (VIEW_HEIGHT * aspect) / 2;
  camera.top = VIEW_HEIGHT / 2;
  camera.bottom = -VIEW_HEIGHT / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (pipeline) pipeline.setSize(window.innerWidth, window.innerHeight);
}

const { sun } = buildWorld(scene, MAP);
const pipeline = createPipeline(renderer, scene, camera);
window.addEventListener('resize', resize);
resize();
const effects = new Effects(scene);
const input = new Input();
const audio = new Audio();
const hud = new Hud();

// ---------------------------------------------------------------- game state
let net = null;
let myId = null;
let connected = false;
const roster = new Map();  // id -> { id, name, slot, paint }
const states = new Map();  // id -> latest server state
const tanks = new Map();   // id -> { group, label, buffer, display, wasAlive }
const bullets = new Map(); // id -> { mesh, x, z, a, t }

// Client-side prediction for our own tank.
const pred = { x: 0, z: 0, a: 0 };
let pending = [];
let seq = 0;
let deadSince = 0;
let killedBy = '';
let lastScoreKey = '';
let lastCountdown = -1;

const bulletGeo = new THREE.SphereGeometry(0.32, 10, 8);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
const glowGeo = new THREE.SphereGeometry(0.55, 10, 8);
const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9d1a, transparent: true, opacity: 0.35, depthWrite: false });

function paintFor(slot) {
  return TANK_PAINT[slot % TANK_PAINT.length];
}

function nameOf(id) {
  return roster.get(id)?.name ?? '?';
}

function ensureTank(id) {
  if (tanks.has(id)) return tanks.get(id);
  const entry = roster.get(id);
  if (!entry) return null;
  const paint = paintFor(entry.slot);
  const group = buildTank(paint);
  const label = new Label(entry.name, `#${paint.hull.toString(16).padStart(6, '0')}`);
  group.add(label.sprite);
  group.visible = false;
  scene.add(group);
  const tank = { group, label, buffer: [], display: { x: 0, z: 0, a: 0, init: false }, wasAlive: false };
  tanks.set(id, tank);
  return tank;
}

function removeTank(id) {
  const tank = tanks.get(id);
  if (!tank) return;
  scene.remove(tank.group);
  tanks.delete(id);
  states.delete(id);
}

function setRoster(list) {
  roster.clear();
  for (const r of list) roster.set(r.id, r);
  for (const id of [...tanks.keys()]) if (!roster.has(id)) removeTank(id);
  for (const id of roster.keys()) ensureTank(id);
  lastScoreKey = '';
}

function clearWorld() {
  for (const id of [...tanks.keys()]) removeTank(id);
  for (const b of bullets.values()) scene.remove(b.mesh);
  bullets.clear();
  roster.clear();
  states.clear();
  pending = [];
  myId = null;
}

// ---------------------------------------------------------------- networking
function onSnapshot(snap) {
  const now = performance.now();
  for (const [id, x, z, a, hp, alive, kills, deaths] of snap.p) {
    states.set(id, { x, z, a, hp, alive: !!alive, kills, deaths });
    const tank = ensureTank(id);
    if (!tank) continue;
    tank.buffer.push({ t: now, x, z, a });
    if (tank.buffer.length > 60) tank.buffer.shift();

    if (id === myId) {
      pred.x = x; pred.z = z; pred.a = a;
      if (alive) {
        pending = pending.filter((i) => i.s > snap.ack);
        for (const i of pending) stepTank(pred, i.k, DT);
      } else {
        pending = [];
      }
      hud.updateHp(hp, !!alive);
    }
  }

  const seen = new Set();
  for (const [id, x, z, a] of snap.b) {
    seen.add(id);
    let b = bullets.get(id);
    if (!b) {
      const mesh = new THREE.Mesh(bulletGeo, bulletMat);
      mesh.add(new THREE.Mesh(glowGeo, glowMat));
      mesh.position.y = 1.45;
      scene.add(mesh);
      b = { mesh, x, z, a, t: now };
      bullets.set(id, b);
    }
    b.x = x; b.z = z; b.a = a; b.t = now;
  }
  for (const [id, b] of bullets) {
    if (!seen.has(id)) { scene.remove(b.mesh); bullets.delete(id); }
  }

  for (const ev of snap.ev) handleEvent(ev);

  const key = [...states.entries()].map(([id, s]) => `${id}:${s.kills}/${s.deaths}`).join('|');
  if (key !== lastScoreKey) {
    lastScoreKey = key;
    hud.updateScores([...roster.values()], states, myId);
  }
}

function distToMe(x, z) {
  return Math.hypot(x - pred.x, z - pred.z);
}

function handleEvent(ev) {
  switch (ev.e) {
    case 'shot':
      effects.muzzleFlash(ev.x, ev.z, ev.a);
      audio.shot(distToMe(ev.x, ev.z));
      if (ev.id === myId) shake = Math.max(shake, 0.25);
      break;
    case 'hit':
      if (ev.tank) {
        effects.sparks(ev.x, ev.z);
        audio.clang(distToMe(ev.x, ev.z));
        if (ev.tank === myId) shake = Math.max(shake, 0.35);
      } else {
        effects.dustPuff(ev.x, ev.z);
        audio.hit(distToMe(ev.x, ev.z));
      }
      break;
    case 'kill': {
      effects.explosion(ev.x, ev.z);
      audio.explosion(distToMe(ev.x, ev.z));
      const killer = nameOf(ev.killer);
      const victim = nameOf(ev.victim);
      hud.addFeed(`${killer} scrapped ${victim}`);
      if (ev.victim === myId) {
        deadSince = performance.now();
        killedBy = killer;
        lastCountdown = -1;
        shake = Math.max(shake, 0.9);
      } else if (ev.killer === myId) {
        hud.showMessage('DIRECT HIT!', `You scrapped ${victim}`, 1600);
      }
      break;
    }
    case 'spawn': {
      effects.spawnFlash(ev.x, ev.z);
      const tank = tanks.get(ev.id);
      if (tank) { tank.display.x = ev.x; tank.display.z = ev.z; tank.display.init = true; }
      if (ev.id === myId) hud.showMessage('ROLL OUT!', 'Find cover, then find a target.', 1500);
      break;
    }
    case 'over': {
      const mine = ev.winner === myId;
      const board = ev.results.slice(0, 4).map((r) => `${r.name} ${r.kills}`).join(' · ');
      hud.showMessage(mine ? 'VICTORY!' : `${ev.name.toUpperCase()} WINS`, `${board} · next round in ${ROUND_END_SECONDS}s`, ROUND_END_SECONDS * 1000);
      if (mine) shake = Math.max(shake, 0.5);
      break;
    }
    case 'reset':
      hud.showMessage('NEW ROUND', `First to ${KILL_LIMIT} kills`, 2000);
      break;
    case 'join':
      if (ev.id !== myId) hud.addFeed(`${ev.name} rolled in`);
      break;
    case 'leave':
      hud.addFeed(`${ev.name} pulled out`);
      break;
    default:
      break;
  }
}

// Matchmade joins arrive as http://host:port/?token=<playerToken>&name=<call sign>
const PARAMS = new URLSearchParams(location.search);
const MATCH_TOKEN = PARAMS.get('token') || null;

async function deploy() {
  const name = document.getElementById('name').value.trim() || 'Sarge';
  const button = document.getElementById('deploy');
  const status = document.getElementById('overlay-status');
  try { localStorage.setItem('tin-tanks-name', name); } catch { /* ignore */ }
  audio.unlock();
  button.disabled = true;
  status.textContent = 'Connecting…';

  clearWorld();
  const url = resolveServerUrl();
  net = new Net(url);
  net.on('welcome', (msg) => {
    myId = msg.id;
    setRoster(msg.roster);
    connected = true;
    input.enabled = true;
    input.mask = 0;
    document.getElementById('overlay').classList.add('hidden');
    hud.showMessage('ROLL OUT!', `WASD to move, SPACE to fire · first to ${KILL_LIMIT} kills`, 2500);
  });
  net.on('roster', (msg) => setRoster(msg.roster));
  net.on('s', onSnapshot);
  net.on('full', () => {
    status.textContent = `Server is full (${MAX_PLAYERS}/${MAX_PLAYERS}). Try again in a moment.`;
  });
  net.on('denied', (msg) => {
    status.textContent = msg.reason || 'This server did not let you in.';
  });
  net.on('close', (e) => {
    const wasConnected = connected;
    connected = false;
    input.enabled = false;
    button.disabled = false;
    document.getElementById('overlay').classList.remove('hidden');
    if (wasConnected) status.textContent = `Disconnected${e.reason ? `: ${e.reason}` : ''}. Deploy again to rejoin.`;
    else if (!status.textContent) status.textContent = 'Could not reach the game server.';
    hud.hideMessage();
    clearWorld();
  });

  try {
    await net.connect(name, MATCH_TOKEN);
  } catch (err) {
    status.textContent = err.message;
    button.disabled = false;
  }
}

// ---------------------------------------------------------------- prediction
let accumulator = 0;
function predictStep() {
  if (!connected || myId === null) return;
  const me = states.get(myId);
  const mask = input.mask;
  seq += 1;
  if (me && me.alive) {
    stepTank(pred, mask, DT);
    pending.push({ s: seq, k: mask });
    if (pending.length > 120) pending.shift();
  }
  net.sendInput(seq, mask);
}

// ---------------------------------------------------------------- rendering
function interpolated(tank, renderTime) {
  const buf = tank.buffer;
  if (buf.length === 0) return null;
  if (renderTime <= buf[0].t) return buf[0];
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= renderTime) {
      const a = buf[i];
      const b = buf[i + 1];
      if (!b) return a;
      const t = (renderTime - a.t) / Math.max(1, b.t - a.t);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, a: angleLerp(a.a, b.a, t) };
    }
  }
  return buf[buf.length - 1];
}

function placeTank(tank, x, z, a, dt, snapNow) {
  const d = tank.display;
  const px = d.x;
  const pz = d.z;
  if (!d.init || snapNow || Math.hypot(d.x - x, d.z - z) > 6) {
    d.x = x; d.z = z; d.a = a; d.init = true;
  } else {
    const k = 1 - Math.exp(-dt * 22);
    d.x += (x - d.x) * k;
    d.z += (z - d.z) * k;
    d.a = angleLerp(d.a, a, k);
  }
  tank.group.position.set(d.x, 0, d.z);
  tank.group.rotation.y = -d.a;
  // Dust from the tracks while rolling.
  const moved = Math.hypot(d.x - px, d.z - pz);
  d.dust = (d.dust || 0) + moved;
  if (moved > 0.02 && d.dust > 0.9) {
    d.dust = 0;
    effects.trackDust(d.x, d.z, d.a);
  }
}

function updateTanks(now, dt) {
  const renderTime = now - INTERP_DELAY;
  for (const [id, tank] of tanks) {
    const s = states.get(id);
    if (!s) { tank.group.visible = false; continue; }
    const justSpawned = s.alive && !tank.wasAlive;
    tank.wasAlive = s.alive;
    tank.group.visible = s.alive;
    tank.label.draw(s.hp);
    if (!s.alive) continue;
    if (id === myId) {
      placeTank(tank, pred.x, pred.z, pred.a, dt, justSpawned);
    } else {
      const p = interpolated(tank, renderTime) || s;
      placeTank(tank, p.x, p.z, p.a, dt, justSpawned);
    }
  }
}

function updateBullets(now) {
  for (const b of bullets.values()) {
    const age = (now - b.t) / 1000;
    b.mesh.position.x = b.x + Math.cos(b.a) * BULLET_SPEED * age;
    b.mesh.position.z = b.z + Math.sin(b.a) * BULLET_SPEED * age;
    b.mesh.rotation.y += 0.3;
  }
}

function updateCamera(dt) {
  const me = tanks.get(myId);
  const focus = me && me.display.init ? me.display : { x: MAP.width / 2, z: MAP.depth / 2 };

  // Keep the view inside the map (with a little margin) so we don't stare at the void.
  const aspect = window.innerWidth / window.innerHeight;
  const halfW = (VIEW_HEIGHT * aspect) / 2;
  const elevation = Math.atan2(CAM_OFFSET.y, CAM_OFFSET.z);
  const halfD = VIEW_HEIGHT / 2 / Math.sin(elevation);
  const margin = 3;
  const tx = halfW >= MAP.width / 2 ? MAP.width / 2 : THREE.MathUtils.clamp(focus.x, halfW - margin, MAP.width - halfW + margin);
  const tz = halfD >= MAP.depth / 2 ? MAP.depth / 2 : THREE.MathUtils.clamp(focus.z, halfD - margin, MAP.depth - halfD + margin);

  const k = 1 - Math.exp(-dt * 6);
  camTarget.x += (tx - camTarget.x) * k;
  camTarget.z += (tz - camTarget.z) * k;

  shake *= Math.exp(-dt * 7);
  const sx = (Math.random() - 0.5) * shake;
  const sz = (Math.random() - 0.5) * shake;
  camera.position.set(camTarget.x + CAM_OFFSET.x + sx, CAM_OFFSET.y, camTarget.z + CAM_OFFSET.z + sz);
  camera.lookAt(camTarget.x + sx, 0, camTarget.z + sz);

  sun.position.set(camTarget.x + SUN_OFFSET.x, SUN_OFFSET.y, camTarget.z + SUN_OFFSET.z);
  sun.target.position.set(camTarget.x, 0, camTarget.z);
}

function updateDeathMessage(now) {
  const me = states.get(myId);
  if (!me || me.alive) return;
  const left = Math.max(0, Math.ceil(RESPAWN_TIME - (now - deadSince) / 1000));
  if (left !== lastCountdown) {
    lastCountdown = left;
    hud.showMessage('SCRAPPED!', `Destroyed by ${killedBy} · back in ${left}s`, 0);
  }
}

let last = performance.now();
let statusTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  accumulator += dt;
  while (accumulator >= DT) {
    accumulator -= DT;
    predictStep();
  }

  updateTanks(now, dt);
  updateBullets(now);
  effects.update(dt);
  updateCamera(dt);
  updateDeathMessage(now);

  statusTimer += dt;
  if (statusTimer > 0.5) {
    statusTimer = 0;
    hud.updateStatus(net ? net.ping : 0, roster.size, audio.muted);
  }

  if (graphics === 'high') pipeline.render(dt);
  else renderer.render(scene, camera);
}

function toggleGraphics() {
  graphics = graphics === 'high' ? 'low' : 'high';
  try { localStorage.setItem('tin-tanks-gfx', graphics); } catch { /* ignore */ }
  hud.showMessage(graphics === 'high' ? 'FANCY GRAPHICS' : 'PLAIN GRAPHICS', graphics === 'high' ? 'ambient occlusion, bloom, SMAA' : 'direct render, for slower machines', 1200);
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyG' && !e.repeat && !(e.target && e.target.tagName === 'INPUT')) toggleGraphics();
});

// ---------------------------------------------------------------- boot
const nameInput = document.getElementById('name');
try { nameInput.value = PARAMS.get('name') || localStorage.getItem('tin-tanks-name') || ''; } catch { nameInput.value = PARAMS.get('name') || ''; }
if (MATCH_TOKEN) {
  document.querySelector('.card p.tag').textContent = 'Your match is ready. Pick a call sign and deploy.';
}
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') deploy(); });
document.getElementById('deploy').addEventListener('click', deploy);
document.getElementById('server-label').textContent = `server: ${resolveServerUrl()}`;
input.onToggleMute = () => audio.toggleMute();
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !input.enabled && !e.repeat) audio.toggleMute();
});

requestAnimationFrame(frame);
