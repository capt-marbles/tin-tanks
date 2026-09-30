import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameyeReporter } from '../src/gameye.js';

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const next = responses.shift() ?? { ok: true, status: 200, json: async () => ({ count: 1, players: [] }) };
    return next;
  };
  return { calls, fetchImpl };
}

test('disabled without a token or session id', async () => {
  const { calls, fetchImpl } = fakeFetch([]);
  const r1 = createGameyeReporter({ token: '', sessionId: 'abc', fetchImpl });
  const r2 = createGameyeReporter({ token: 't', sessionId: '', fetchImpl });
  assert.equal(r1.enabled, false);
  assert.equal(r2.enabled, false);
  await r1.playerJoined('p1');
  await r2.playerLeft('p1');
  assert.equal(calls.length, 0);
});

test('join and leave send session + players with bearer auth', async () => {
  const { calls, fetchImpl } = fakeFetch([]);
  const r = createGameyeReporter({ apiUrl: 'https://api.example.test/', token: 'tok', sessionId: 'sess-1', fetchImpl });
  assert.equal(r.enabled, true);
  const joined = await r.playerJoined('tank-1');
  assert.equal(joined.count, 1);
  await r.playerLeft('tank-1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.example.test/session/player/join');
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.deepEqual(calls[0].body, { session: 'sess-1', players: ['tank-1'] });
  assert.equal(calls[1].url, 'https://api.example.test/session/player/leave');
  assert.equal(calls[1].method, 'DELETE');
  assert.deepEqual(calls[1].body, { session: 'sess-1', players: ['tank-1'] }, 'leave must include session (API 404s without it)');
});

test('retries once after a failed response and gives up quietly', async () => {
  const { calls, fetchImpl } = fakeFetch([
    { ok: false, status: 503, json: async () => ({}) },
    { ok: false, status: 503, json: async () => ({}) },
  ]);
  const logs = [];
  const r = createGameyeReporter({ token: 'tok', sessionId: 's', fetchImpl, log: (l) => logs.push(l) });
  const t0 = Date.now();
  const result = await r.playerJoined('tank-2');
  assert.equal(result, null);
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 >= 1900, 'waits before the retry');
  assert.ok(logs.some((l) => l.includes('retrying')));
});
