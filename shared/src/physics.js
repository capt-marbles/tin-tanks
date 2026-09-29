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
