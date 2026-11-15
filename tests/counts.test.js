const { test } = require('node:test');
const assert = require('node:assert/strict');
const { countChats } = require('../extension/counts');
const reply = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
test('counts every page, ignores estimated totals, and deduplicates across categories', async () => {
  const calls = [];
  const result = await countChats(async (path, options) => {
    if (path === '/api/auth/session') return reply({ accessToken: 'test-only', account: { id: 'workspace' } });
    assert.equal(options.headers['ChatGPT-Account-Id'], 'workspace');
    const url = new URL(path, 'https://chatgpt.com'); calls.push(url);
    const offset = +url.searchParams.get('offset');
    const archive = url.searchParams.get('is_archived') === 'true';
    const starred = url.searchParams.get('is_starred') === 'true';
    const ids = archive ? ['archived'] : starred ? ['pinned', 'a'] : ['a', 'b', 'c'];
    const items = ids.slice(offset, offset + 2).map(id => ({ id }));
    return reply({ items, total: offset + items.length + 1, limit: 100 });
  }, () => {}, () => false);
  assert.deepEqual([...result.active].sort(), ['a', 'b', 'c', 'pinned']);
  assert.deepEqual([...result.archived], ['archived']);
  assert(calls.some(url => url.searchParams.get('offset') === '3'));
});
test('repeated pages fail explicitly instead of returning a false total', async () => {
  await assert.rejects(countChats(async path => reply(path === '/api/auth/session' ? { accessToken: 'test', account: { id: 'workspace' } } : { items: [{ id: 'repeat' }], total: 2 }), () => {}, () => false), /repeated a page/);
});
test('authentication, rate limits and cancellation do not become zero counts', async () => {
  await assert.rejects(countChats(async () => reply({}), () => {}, () => false), /Sign in/);
  await assert.rejects(countChats(async () => reply({}, 429), () => {}, () => false), /rate limiting/);
  await assert.rejects(countChats(async () => { throw Error('should not fetch'); }, () => {}, () => true), /cancelled/);
});
