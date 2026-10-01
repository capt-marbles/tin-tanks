import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMatchmakerClient, validatePlayerToken } from '../src/matchmaker.js';

const MATCH = 'a'.repeat(64);
const SECRET = 'server-secret';
const PID = '01HZX3M7Q8K2N4P6R8T0V2W4Y6'; // 26-char Crockford ULID

function mint(matchId, playerId, expSec, key = SECRET) {
  const sig = createHmac('sha256', key).update(`${matchId}.${playerId}.${expSec}`).digest('base64url');
  return `${matchId}.${playerId}.${expSec}.${sig}`;
}

test('accepts a well-formed, unexpired token for this match', () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  assert.equal(validatePlayerToken(mint(MATCH, PID, exp), MATCH, SECRET), PID);
});

test('rejects wrong match, expiry, signature, shape', () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  assert.equal(validatePlayerToken(mint('b'.repeat(64), PID, exp), MATCH, SECRET), null, 'other match');
  assert.equal(validatePlayerToken(mint(MATCH, PID, exp - 1200), MATCH, SECRET), null, 'expired');
  assert.equal(validatePlayerToken(mint(MATCH, PID, exp, 'wrong-key'), MATCH, SECRET), null, 'bad signature');
  assert.equal(validatePlayerToken('nope', MATCH, SECRET), null, 'garbage');
  assert.equal(validatePlayerToken(undefined, MATCH, SECRET), null, 'missing');
  assert.equal(validatePlayerToken(mint(MATCH, 'not-a-ulid', exp), MATCH, SECRET), null, 'bad player id');
});

test('disabled without MM_* and never calls out', async () => {
  const calls = [];
  const mm = createMatchmakerClient({ url: '', matchId: '', serverToken: '', fetchImpl: async (u) => { calls.push(u); return { ok: true, json: async () => ({}) }; } });
  assert.equal(mm.enabled, false);
  await mm.start();
  await mm.joined(PID);
  await mm.complete({});
  assert.equal(calls.length, 0);
  assert.equal(mm.validatePlayerToken('x'), null);
});

test('posts lifecycle calls with bearer auth and matchId', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const mm = createMatchmakerClient({ url: 'https://mm.test/v1/server/tin-tanks/', matchId: MATCH, serverToken: SECRET, fetchImpl, heartbeatSeconds: 3600 });
  assert.equal(mm.enabled, true);
  await mm.start();
  await mm.joined(PID);
  await mm.left(PID);
  await mm.slots(3);
  await mm.complete({ winner: 1 });
  mm.stop();
  assert.deepEqual(calls.map((c) => c.url), [
    'https://mm.test/v1/server/tin-tanks/ready',
    `https://mm.test/v1/server/tin-tanks/players/${PID}/joined`,
    `https://mm.test/v1/server/tin-tanks/players/${PID}/left`,
    'https://mm.test/v1/server/tin-tanks/slots',
    'https://mm.test/v1/server/tin-tanks/complete',
  ]);
  for (const c of calls) {
    assert.equal(c.method, 'POST');
    assert.equal(c.auth, `Bearer ${SECRET}`);
    assert.equal(c.body.matchId, MATCH);
  }
  assert.equal(calls[3].body.open, 3);
  assert.deepEqual(calls[4].body.results, { winner: 1 });
});

test('does not retry 4xx responses', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return { ok: false, status: 409, text: async () => 'not_live' }; };
  const mm = createMatchmakerClient({ url: 'https://mm.test/v1/server/t', matchId: MATCH, serverToken: SECRET, fetchImpl });
  assert.equal(await mm.heartbeat?.(), undefined);
  await mm.joined(PID);
  assert.equal(n, 1);
});
