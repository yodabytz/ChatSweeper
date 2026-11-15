const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../extension/history-api');
const ok = data => ({ ok: true, json: async () => data });
const item = { id: 'chat-a', title: 'Example', archived: true, pinned: false };
function fixture(overrides = {}) {
  let archived = true, calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/auth/session') return ok({ accessToken: 'test-token', account: { id: overrides.workspace || 'workspace' } });
    if (options.method === 'PATCH') { if (!overrides.fail) archived = JSON.parse(options.body).is_archived; return ok({ success: !overrides.fail }); }
    return ok(Object.assign({ conversation_id: 'chat-a', title: 'Example', mapping: {}, is_archived: archived }, overrides.data));
  };
  return { fetcher, calls };
}
test('restoration is scoped to the workspace, sends the correct state, and verifies it', async () => {
  const f = fixture(); await api.change(f.fetcher, item, 'restore', 'workspace', true);
  const patches = f.calls.filter(c => c.options.method === 'PATCH');
  assert.equal(patches.length, 1); assert.deepEqual(JSON.parse(patches[0].options.body), { is_archived: false });
  assert.equal(patches[0].options.headers['ChatGPT-Account-Id'], 'workspace');
  assert.equal(f.calls.length, 4);
});
test('changed workspace, title, state, or pinned status prevents mutation', async () => {
  for (const [options, action, expected] of [
    [{ workspace: 'different' }, 'restore', /workspace changed/],
    [{ data: { title: 'Renamed' } }, 'restore', /renamed/],
    [{ data: { is_archived: false } }, 'restore', /archive status changed/],
    [{ data: { is_archived: null } }, 'restore', /verify/],
    [{ data: { is_starred: true } }, 'delete', /Pinned/]
  ]) {
    const f = fixture(options); await assert.rejects(api.change(f.fetcher, item, action, 'workspace', true), expected);
    assert.equal(f.calls.filter(c => c.options.method === 'PATCH').length, 0);
  }
});
test('failed mutation and unconfirmed archive state are not reported as success', async () => {
  await assert.rejects(api.change(fixture({ fail: true }).fetcher, item, 'restore', 'workspace', true), /did not confirm/);
  await assert.rejects(api.change(fixture({ data: { is_archived: true } }).fetcher, item, 'restore', 'workspace', true), /not confirmed/);
});
test('preview follows the current branch and excludes hidden/system/tool messages', () => {
  const mapping = {
    root: { id: 'root', parent: null, message: { author: { role: 'system' }, content: { parts: ['system secret'] } } },
    user: { id: 'user', parent: 'root', message: { author: { role: 'user' }, content: { parts: ['<script>alert(1)</script>'] } } },
    hidden: { id: 'hidden', parent: 'user', message: { author: { role: 'assistant' }, metadata: { is_visually_hidden_from_conversation: true }, content: { parts: ['hidden reasoning'] } } },
    current: { id: 'current', parent: 'hidden', message: { author: { role: 'assistant' }, content: { parts: ['Visible reply', { content_type: 'image_asset_pointer' }] } } },
    other: { id: 'other', parent: 'user', message: { author: { role: 'assistant' }, content: { parts: ['Wrong branch'] } } }
  };
  const preview = api.preview({ mapping, current_node: 'current' });
  assert.equal(preview.length, 2); assert.match(preview[0].text, /<script>/);
  assert.match(preview[1].text, /Visible reply.*\n\[Attachment/);
  assert(!JSON.stringify(preview).match(/secret|reasoning|Wrong branch/));
});
test('preview rejects missing/cyclic branches and bounds long excerpts', () => {
  assert.throws(() => api.preview({ mapping: {}, current_node: 'missing' }), /unavailable/);
  const a = { id: 'a', parent: 'a', message: { author: { role: 'system' } } };
  assert.throws(() => api.preview({ mapping: { a }, current_node: 'a' }), /invalid/);
  a.parent = null; a.message = { author: { role: 'user' }, content: { parts: ['x'.repeat(10000)] } };
  assert(api.preview({ mapping: { a }, current_node: 'a' })[0].text.length < 2500);
});
test('history filtering includes unseen chats and sorts dates with unknowns last', () => {
  const rows = [{ id: 'b', title: 'B recipe', archived: false, created: 200, updated: 100 }, { id: 'a', title: 'A recipe', archived: true, created: 100, updated: 200 }, { id: 'z', title: 'Z notes', archived: false, created: null }];
  assert.deepEqual(api.filter(rows, { scope: 'archived', query: 'RECIPE' }).map(r => r.id), ['a']);
  assert.deepEqual(api.filter(rows, { scope: 'all', sort: 'created-asc' }).map(r => r.id), ['a', 'b', 'z']);
  assert.deepEqual(api.filter(rows, { scope: 'all', sort: 'title-desc' }).map(r => r.id), ['z', 'b', 'a']);
  assert.deepEqual(api.filter(rows, { scope: 'all', days: 30, now: 20000000000 }).map(r => r.id), ['a', 'b']);
});
