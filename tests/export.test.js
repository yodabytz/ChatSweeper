const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exportChats } = require('../extension/export');
const ok = data => ({ ok: true, json: async () => data });
test('export rejects a workspace change before fetching any conversation', async () => {
  let requests = 0;
  await assert.rejects(exportChats(async () => { requests++; return ok({ accessToken: 'secret', account: { id: 'other' } }); }, ['a'], 'original', () => {}, () => false), /workspace changed/);
  assert.equal(requests, 1);
});
test('export rejects missing contents, mismatched IDs and cancellation', async () => {
  for (const data of [{ title: 'Missing content' }, { id: 'wrong', mapping: {} }]) {
    await assert.rejects(exportChats(async path => ok(path === '/api/auth/session' ? { accessToken: 'secret', account: { id: 'workspace' } } : data), ['a'], 'workspace', () => {}, () => false), /incomplete|different/);
  }
  await assert.rejects(exportChats(async () => { throw Error('must not fetch'); }, ['a'], 'workspace', () => {}, () => true), /stopped/);
});
