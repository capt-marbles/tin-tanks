import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSession, joinUrl, countRunning } from '../src/matchmaking.js';

const sessions = [
  { id: 'a', image: 'tin-tanks', status: 'running', playerCount: 4, created: 1, host: '1.1.1.1', port: { '8080/tcp': 1001 } },
  { id: 'b', image: 'tin-tanks', status: 'running', playerCount: 1, created: 2, host: '1.1.1.1', port: { '8080/tcp': 1002 } },
  { id: 'c', image: 'tin-tanks', status: 'running', playerCount: 3, created: 3, host: '1.1.1.1', port: { '8080/tcp': 1003 } },
  { id: 'd', image: 'other', status: 'running', playerCount: 0, created: 4, host: '1.1.1.1', port: { '8080/tcp': 1004 } },
  { id: 'e', image: 'tin-tanks', status: 'stopped', playerCount: 0, created: 5, host: '1.1.1.1', port: { '8080/tcp': 1005 } },
];

test('prefers the fullest session with a free slot', () => {
  assert.equal(pickSession(sessions, { image: 'tin-tanks', maxPlayers: 4 }).id, 'c');
});

test('ignores full, stopped and other-image sessions', () => {
  const only = sessions.filter((s) => ['a', 'd', 'e'].includes(s.id));
  assert.equal(pickSession(only, { image: 'tin-tanks', maxPlayers: 4 }), null);
});

test('treats a missing playerCount as empty', () => {
  const s = [{ id: 'x', image: 'tin-tanks', status: 'running', created: 1 }];
  assert.equal(pickSession(s, { image: 'tin-tanks', maxPlayers: 4 }).id, 'x');
});

test('join url from list shape and from create-response shape', () => {
  assert.equal(joinUrl(sessions[1]), 'http://1.1.1.1:1002/');
  assert.equal(joinUrl({ host: '2.2.2.2', ports: [{ type: 'tcp', container: 8080, host: 49160 }] }), 'http://2.2.2.2:49160/');
  assert.equal(joinUrl({ host: '2.2.2.2' }), null);
});

test('counts only running sessions of the image', () => {
  assert.equal(countRunning(sessions, 'tin-tanks'), 3);
});

test('a pinned tag ignores sessions on other builds', () => {
  const s = [
    { id: 'old', image: 'tin-tanks', tag: 'sha-old', status: 'running', playerCount: 1, created: 1 },
    { id: 'new', image: 'tin-tanks', tag: 'sha-new', status: 'running', playerCount: 0, created: 2 },
  ];
  assert.equal(pickSession(s, { image: 'tin-tanks', maxPlayers: 4, tag: 'sha-new' }).id, 'new');
  assert.equal(pickSession(s, { image: 'tin-tanks', maxPlayers: 4 }).id, 'old');
  assert.equal(countRunning(s, 'tin-tanks', 'sha-new'), 1);
});
