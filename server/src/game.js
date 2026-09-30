// Authoritative game simulation. No networking in here so it can be unit tested.
import {
  MAX_PLAYERS, TANK_HP, TANK_RADIUS, INPUT, BULLET_LIFE, BULLET_DAMAGE, BULLET_RADIUS,
  FIRE_COOLDOWN, MUZZLE_OFFSET, RESPAWN_TIME, TANK_PAINT,
} from '@tin-tanks/shared/constants';
import { MAP } from '@tin-tanks/shared/map';
import { stepTank, stepBullet, depenetrate } from '@tin-tanks/shared/physics';

export class Game {
  constructor(map = MAP) {
    this.map = map;
    this.players = new Map(); // id -> player
    this.bullets = [];
    this.events = [];         // drained into each snapshot
    this.tick = 0;
    this.time = 0;
    this.nextPlayerId = 1;
    this.nextBulletId = 1;
    this.rosterVersion = 0;
    this.lastOccupied = 0;    // sim time when a player was last present
  }

  /** Seconds since the last player left (or since start, if nobody ever joined). */
  idleSeconds() {
    return this.players.size > 0 ? 0 : this.time - this.lastOccupied;
  }

  get isFull() {
    return this.players.size >= MAX_PLAYERS;
  }

  /** Returns the new player, or null when the server is full. */
  addPlayer(name) {
    if (this.isFull) return null;
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot += 1;

    const player = {
      id: this.nextPlayerId++,
      slot,
      name: sanitizeName(name) || `Tank ${slot + 1}`,
      x: 0, z: 0, a: 0,
      hp: TANK_HP,
      alive: true,
      kills: 0,
      deaths: 0,
      input: 0,
      lastSeq: 0,
      cooldown: 0,
      respawnAt: 0,
    };
    this.spawn(player);
    this.players.set(player.id, player);
    this.rosterVersion += 1;
    this.events.push({ e: 'join', id: player.id, name: player.name });
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.rosterVersion += 1;
    this.events.push({ e: 'leave', id, name: player.name });
  }

  setInput(id, mask, seq) {
    const player = this.players.get(id);
    if (!player) return;
    player.input = mask & 31;
    if (typeof seq === 'number' && seq > player.lastSeq) player.lastSeq = seq;
  }

  /** Place a tank on the spawn point furthest from any living enemy. */
  spawn(player) {
    const enemies = [...this.players.values()].filter((p) => p !== player && p.alive);
    let best = this.map.spawns[player.slot % this.map.spawns.length];
    let bestScore = -1;
    for (const s of this.map.spawns) {
      let nearest = Infinity;
      for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.x - s.x, e.z - s.z));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = s;
      }
    }
    player.x = best.x;
    player.z = best.z;
    // Face toward the centre of the map so the first move feels natural.
    player.a = Math.atan2(this.map.depth / 2 - best.z, this.map.width / 2 - best.x);
    player.hp = TANK_HP;
    player.alive = true;
    player.cooldown = 0;
    player.input = 0;
  }

  update(dt) {
    this.tick += 1;
    this.time += dt;
    if (this.players.size > 0) this.lastOccupied = this.time;

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) {
          this.spawn(p);
          this.events.push({ e: 'spawn', id: p.id, x: p.x, z: p.z });
        }
        continue;
      }
      stepTank(p, p.input, dt, this.map);
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.input & INPUT.FIRE && p.cooldown === 0) this.fire(p);
    }

    this.separateTanks();
    this.updateBullets(dt);
  }

  fire(p) {
    p.cooldown = FIRE_COOLDOWN;
    const bullet = {
      id: this.nextBulletId++,
      owner: p.id,
      x: p.x + Math.cos(p.a) * MUZZLE_OFFSET,
      z: p.z + Math.sin(p.a) * MUZZLE_OFFSET,
      a: p.a,
      life: BULLET_LIFE,
    };
    this.bullets.push(bullet);
    this.events.push({ e: 'shot', id: p.id, x: bullet.x, z: bullet.z, a: p.a });
  }

  /** Push overlapping tanks apart so they cannot drive through each other. */
  separateTanks() {
    const alive = [...this.players.values()].filter((p) => p.alive);
    const minDist = TANK_RADIUS * 2;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let dist = Math.hypot(dx, dz);
        if (dist >= minDist) continue;
        if (dist < 1e-6) { dx = 1; dz = 0; dist = 1; }
        const push = (minDist - dist) / 2;
        dx /= dist;
        dz /= dist;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
        depenetrate(a, TANK_RADIUS);
        depenetrate(b, TANK_RADIUS);
        clampToMap(a, this.map);
        clampToMap(b, this.map);
      }
    }
  }

  updateBullets(dt) {
    const hitRadius = TANK_RADIUS + BULLET_RADIUS;
    const survivors = [];
    for (const b of this.bullets) {
      if (!stepBullet(b, dt, this.map)) {
        this.events.push({ e: 'hit', x: b.x, z: b.z, tank: 0 });
        continue;
      }
      let struck = null;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === b.owner) continue;
        if (Math.hypot(p.x - b.x, p.z - b.z) < hitRadius) { struck = p; break; }
      }
      if (struck) {
        this.damage(struck, b.owner);
        this.events.push({ e: 'hit', x: b.x, z: b.z, tank: struck.id });
        continue;
      }
      survivors.push(b);
    }
    this.bullets = survivors;
  }

  damage(victim, attackerId) {
    victim.hp -= BULLET_DAMAGE;
    if (victim.hp > 0) return;
    victim.hp = 0;
    victim.alive = false;
    victim.deaths += 1;
    victim.respawnAt = this.time + RESPAWN_TIME;
    const attacker = this.players.get(attackerId);
    if (attacker) attacker.kills += 1;
    this.events.push({
      e: 'kill', victim: victim.id, killer: attackerId, x: victim.x, z: victim.z,
    });
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, slot: p.slot, paint: TANK_PAINT[p.slot % TANK_PAINT.length],
    }));
  }

  /** Snapshot for broadcast. `ack` is filled in per client by the caller. */
  snapshot() {
    const players = [...this.players.values()].map((p) => [
      p.id, round(p.x), round(p.z), round(p.a, 3), p.hp, p.alive ? 1 : 0, p.kills, p.deaths,
    ]);
    const bullets = this.bullets.map((b) => [b.id, round(b.x), round(b.z), round(b.a, 3), b.owner]);
    const events = this.events;
    this.events = [];
    return { t: 's', tick: this.tick, time: round(this.time, 3), p: players, b: bullets, ev: events };
  }
}

function clampToMap(p, map) {
  p.x = Math.max(TANK_RADIUS, Math.min(map.width - TANK_RADIUS, p.x));
  p.z = Math.max(TANK_RADIUS, Math.min(map.depth - TANK_RADIUS, p.z));
}

function round(v, places = 2) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

export function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^\w \-'.!]/g, '').trim().slice(0, 16);
}
