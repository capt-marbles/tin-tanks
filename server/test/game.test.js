import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import {
  DT, INPUT, TANK_HP, BULLET_DAMAGE, RESPAWN_TIME, FIRE_COOLDOWN, MAX_PLAYERS,
} from '@tin-tanks/shared/constants';

function run(game, seconds) {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) game.update(DT);
}

test('accepts four players then reports full', () => {
  const g = new Game();
  const ids = [];
  for (let i = 0; i < MAX_PLAYERS; i++) ids.push(g.addPlayer(`p${i}`).id);
  assert.equal(g.addPlayer('fifth'), null);
  g.removePlayer(ids[1]);
  const again = g.addPlayer('back');
  assert.ok(again);
  assert.equal(again.slot, 1, 'freed slot is reused so paint schemes stay unique');
});

test('names are sanitised and defaulted', () => {
  const g = new Game();
  assert.equal(g.addPlayer('<script>Bob</script>').name, 'scriptBobscript');
  assert.equal(g.addPlayer('').name, 'Tank 2');
  assert.equal(g.addPlayer('x'.repeat(40)).name.length, 16);
});

test('tank moves with input and stops at the map edge', () => {
  const g = new Game();
  const p = g.addPlayer('mover');
  p.x = 6; p.z = 6;
  g.setInput(p.id, INPUT.LEFT, 1);
  run(g, 2);
  assert.ok(p.x > 1 && p.x < 1.2, `clamped to radius, got ${p.x}`);
  assert.equal(p.lastSeq, 1);
});

test('tank cannot drive through a building', () => {
  const g = new Game();
  const p = g.addPlayer('driver');
  // House at x=18..26, z=14..20. Start left of it, drive right.
  p.x = 12; p.z = 17;
  g.setInput(p.id, INPUT.RIGHT);
  run(g, 3);
  assert.ok(p.x < 18, `should be blocked before x=18, got ${p.x}`);
  assert.ok(p.x > 16.5, `should be pressed against the wall, got ${p.x}`);
});

test('shells damage and kill, then respawn after the delay', () => {
  const g = new Game();
  const shooter = g.addPlayer('shooter');
  const target = g.addPlayer('target');
  // Line them up in open ground on the high street.
  shooter.x = 70; shooter.z = 40; shooter.a = 0;
  target.x = 80; target.z = 40;
  g.setInput(target.id, 0);

  let kills = 0;
  for (let shot = 0; shot < 3; shot++) {
    g.setInput(shooter.id, INPUT.FIRE);
    g.update(DT);
    g.setInput(shooter.id, 0);
    run(g, FIRE_COOLDOWN + 0.1);
    // Keep the shooter facing right; it doesn't move without movement keys.
    kills = shooter.kills;
  }
  assert.equal(target.alive, false, 'three hits should destroy a tank');
  assert.equal(target.hp, 0);
  assert.equal(target.deaths, 1);
  assert.equal(kills, 1);

  const snap = g.snapshot();
  assert.ok(snap.ev.some((e) => e.e === 'kill' && e.victim === target.id && e.killer === shooter.id));

  run(g, RESPAWN_TIME + 0.1);
  assert.equal(target.alive, true, 'respawns after RESPAWN_TIME');
  assert.equal(target.hp, TANK_HP);
});

test('one hit removes BULLET_DAMAGE and the shell disappears', () => {
  const g = new Game();
  const shooter = g.addPlayer('a');
  const target = g.addPlayer('b');
  shooter.x = 70; shooter.z = 40; shooter.a = 0;
  target.x = 76; target.z = 40;
  g.setInput(shooter.id, INPUT.FIRE);
  g.update(DT);
  assert.equal(g.bullets.length, 1);
  g.setInput(shooter.id, 0);
  run(g, 0.5);
  assert.equal(target.hp, TANK_HP - BULLET_DAMAGE);
  assert.equal(g.bullets.length, 0);
});

test('shells are stopped by cover', () => {
  const g = new Game();
  const shooter = g.addPlayer('a');
  const target = g.addPlayer('b');
  // Ruin at x=26..34, z=26..31 sits between them.
  shooter.x = 22; shooter.z = 28; shooter.a = 0;
  target.x = 38; target.z = 28;
  g.setInput(shooter.id, INPUT.FIRE);
  g.update(DT);
  g.setInput(shooter.id, 0);
  run(g, 1);
  assert.equal(target.hp, TANK_HP, 'shell should hit the ruin, not the tank');
  assert.equal(g.bullets.length, 0);
});

test('tanks push apart instead of overlapping', () => {
  const g = new Game();
  const a = g.addPlayer('a');
  const b = g.addPlayer('b');
  a.x = 40; a.z = 40; b.x = 40.5; b.z = 40;
  g.update(DT);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2.19);
});

test('snapshot is compact and drains events', () => {
  const g = new Game();
  g.addPlayer('a');
  const snap = g.snapshot();
  assert.equal(snap.t, 's');
  assert.equal(snap.p.length, 1);
  assert.equal(snap.p[0].length, 8);
  assert.ok(snap.ev.some((e) => e.e === 'join'));
  assert.equal(g.snapshot().ev.length, 0);
});

test('idle timer counts only while the room is empty', () => {
  const g = new Game();
  run(g, 2);
  assert.ok(g.idleSeconds() >= 1.99, 'empty from the start counts as idle');
  const p = g.addPlayer('a');
  run(g, 1);
  assert.equal(g.idleSeconds(), 0);
  g.removePlayer(p.id);
  run(g, 3);
  assert.ok(g.idleSeconds() >= 2.99 && g.idleSeconds() < 3.1, `got ${g.idleSeconds()}`);
});

test('a tank shoved into a tree is pushed back out and can drive again', () => {
  const g = new Game();
  const p = g.addPlayer('stuck');
  // Tree at (36, 40) r 0.9 -> box x 35.1..36.9, z 39.1..40.9. Plant the tank inside it.
  p.x = 36.3; p.z = 40.2;
  g.setInput(p.id, 0);
  g.update(DT);
  assert.ok(Math.hypot(p.x - 36, p.z - 40) >= 0.9 + 1.1 - 0.01, `should be outside the tree, at ${p.x},${p.z}`);
  const before = { x: p.x, z: p.z };
  g.setInput(p.id, INPUT.UP);
  run(g, 1);
  assert.ok(p.z < before.z - 5, 'drives freely afterwards');
});

test('tank separation cannot leave a tank inside cover', () => {
  const g = new Game();
  const a = g.addPlayer('a');
  const b = g.addPlayer('b');
  // Tree box x 35.1..36.9 at z 39.1..40.9. Put b just left of it and a overlapping b from the left.
  b.x = 33.9; b.z = 40; a.x = 32.9; a.z = 40;
  run(g, 1);
  for (const t of [a, b]) {
    assert.ok(Math.hypot(t.x - 36, t.z - 40) >= 1.99, `${t.name} ended inside the tree at ${t.x},${t.z}`);
  }
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2.19, 'tanks are apart');
});
