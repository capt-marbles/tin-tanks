import {
  INPUT, TANK_SPEED, TANK_TURN_RATE, TANK_RADIUS, BULLET_SPEED, BULLET_RADIUS,
} from './constants.js';
import { MAP, solidBoxes } from './map.js';

const SOLIDS = solidBoxes(MAP);

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Move angle `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from, to, maxStep) {
  const diff = wrapAngle(to - from);
  if (Math.abs(diff) <= maxStep) return to;
  return wrapAngle(from + Math.sign(diff) * maxStep);
}

/** Interpolate angles along the short way round. */
export function angleLerp(a, b, t) {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

export function circleOverlapsBox(cx, cz, r, box) {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.w));
  const nz = Math.max(box.z, Math.min(cz, box.z + box.d));
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz < r * r;
}

export function circleHitsSolid(cx, cz, r, solids = SOLIDS) {
  for (const box of solids) {
    if (circleOverlapsBox(cx, cz, r, box)) return true;
  }
  return false;
}

/** First intersection along a segment with an expanded box; null means no hit. */
export function segmentBox(x, z, nx, nz, box, radius = 0) {
  let near = 0;
  let far = 1;
  for (const [start, delta, lo, hi] of [
    [x, nx - x, box.x - radius, box.x + box.w + radius],
    [z, nz - z, box.z - radius, box.z + box.d + radius],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < lo || start > hi) return null;
    } else {
      const a = (lo - start) / delta;
      const b = (hi - start) / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near;
}

export function segmentCircle(x, z, nx, nz, cx, cz, radius) {
  const dx = nx - x, dz = nz - z, ox = x - cx, oz = z - cz;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a === 0) return null;
  const b = 2 * (ox * dx + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Push a circle out of any solid it overlaps. Tanks never get there by driving
 * (moves into cover are rejected) but tank-vs-tank separation can shove one
 * into a tree; without this it would be stuck for good. Mutates `c` ({x, z}).
 */
export function depenetrate(c, r, solids = SOLIDS) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const box of solids) {
      const nx = Math.max(box.x, Math.min(c.x, box.x + box.w));
      const nz = Math.max(box.z, Math.min(c.z, box.z + box.d));
      const dx = c.x - nx;
      const dz = c.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      moved = true;
      if (d2 > 1e-9) {
        // Centre is outside the box: push straight away from the nearest point.
        const d = Math.sqrt(d2);
        c.x += (dx / d) * (r - d + 1e-3);
        c.z += (dz / d) * (r - d + 1e-3);
      } else {
        // Centre is inside the box: leave through the nearest face.
        const exits = [
          { dx: -(c.x - box.x + r), dz: 0 },
          { dx: box.x + box.w - c.x + r, dz: 0 },
          { dx: 0, dz: -(c.z - box.z + r) },
          { dx: 0, dz: box.z + box.d - c.z + r },
        ];
        exits.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dz) - (Math.abs(b.dx) + Math.abs(b.dz)));
        c.x += exits[0].dx + Math.sign(exits[0].dx) * 1e-3;
        c.z += exits[0].dz + Math.sign(exits[0].dz) * 1e-3;
      }
    }
    if (!moved) return c;
  }
  return c;
}

/** Direction vector for an input mask. Returns null when no movement keys are held. */
export function inputDirection(mask) {
  let dx = 0;
  let dz = 0;
  if (mask & INPUT.LEFT) dx -= 1;
  if (mask & INPUT.RIGHT) dx += 1;
  if (mask & INPUT.UP) dz -= 1;
  if (mask & INPUT.DOWN) dz += 1;
  if (dx === 0 && dz === 0) return null;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len };
}

/**
 * Advance a tank by one step. Mutates and returns `tank` ({x, z, a}).
 * Movement slides along walls by resolving each axis separately.
 * Pure and deterministic so the client can run it for prediction.
 */
export function stepTank(tank, mask, dt, map = MAP, solids = SOLIDS) {
  depenetrate(tank, TANK_RADIUS, solids);
  const dir = inputDirection(mask);
  if (!dir) return tank;

  const target = Math.atan2(dir.z, dir.x);
  tank.a = turnToward(tank.a, target, TANK_TURN_RATE * dt);

  const step = TANK_SPEED * dt;
  const minX = TANK_RADIUS;
  const maxX = map.width - TANK_RADIUS;
  const minZ = TANK_RADIUS;
  const maxZ = map.depth - TANK_RADIUS;

  const nx = Math.max(minX, Math.min(maxX, tank.x + dir.x * step));
  if (!circleHitsSolid(nx, tank.z, TANK_RADIUS, solids)) tank.x = nx;

  const nz = Math.max(minZ, Math.min(maxZ, tank.z + dir.z * step));
  if (!circleHitsSolid(tank.x, nz, TANK_RADIUS, solids)) tank.z = nz;

  return tank;
}

/** Advance a shell. Returns false once it leaves the map or hits cover. */
export function stepBullet(bullet, dt, map = MAP, solids = SOLIDS) {
  bullet.x += Math.cos(bullet.a) * BULLET_SPEED * dt;
  bullet.z += Math.sin(bullet.a) * BULLET_SPEED * dt;
  bullet.life -= dt;
  if (bullet.life <= 0) return false;
  if (bullet.x < 0 || bullet.z < 0 || bullet.x > map.width || bullet.z > map.depth) return false;
  if (circleHitsSolid(bullet.x, bullet.z, BULLET_RADIUS, solids)) return false;
  return true;
}
