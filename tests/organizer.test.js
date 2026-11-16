const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { launch } = require('./browser-helper');
let browser;
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });
async function setup(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const records = Array.from({ length: 65 }, (_, i) => ({ id: 'chat-' + i, title: 'Conversation ' + String(i).padStart(2, '0'), update_time: 1700000000 + i, create_time: 1600000000 + i, is_archived: i >= 60, is_starred: i === 1 }));
  const mutations = [];
  let workspace = 'workspace';
  await page.route('https://chatgpt.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { accessToken: 'fixture-token', account: { id: workspace } } });
    if (url.pathname === '/backend-api/conversations') {
      const list = records.filter(r => !r.deleted && r.is_archived === (url.searchParams.get('is_archived') === 'true'));
      const offset = +url.searchParams.get('offset');
      return route.fulfill({ json: { items: list.slice(offset, offset + 25), total: offset + 26 } });
    }
    if (url.pathname.startsWith('/backend-api/conversation/')) {
      const id = url.pathname.split('/').pop(), row = records.find(r => r.id === id);
      if (route.request().method() === 'PATCH') {
        mutations.push({ id, data: route.request().postDataJSON() });
        if (options.fail === id) return route.fulfill({ status: 500, json: {} });
        if (options.delay) await new Promise(r => setTimeout(r, options.delay));
        if ('is_archived' in route.request().postDataJSON()) row.is_archived = route.request().postDataJSON().is_archived;
        if (route.request().postDataJSON().is_visible === false) row.deleted = true;
        return route.fulfill({ json: { success: true } });
      }
      if (options.slowPreview === id) await new Promise(r => setTimeout(r, 700));
      return route.fulfill({ json: { ...row, conversation_id: id, current_node: 'reply', mapping: { user: { id: 'user', parent: null, message: { author: { role: 'user' }, content: { parts: ['Question for ' + id] } } }, reply: { id: 'reply', parent: 'user', message: { author: { role: 'assistant' }, content: { parts: ['<img src=x onerror="window.injected=true"> Reply for ' + id] } } } } } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><nav><a href="/c/chat-0">Only one chat loaded in sidebar</a></nav></body></html>' });
  });
  await page.goto('https://chatgpt.com/');
  for (const file of ['counts.js', 'export.js', 'history-api.js', 'organizer.js']) await page.addScriptTag({ content: fs.readFileSync('extension/' + file, 'utf8') });
  await page.evaluate(() => window.ChatSweeperOrganizer.open());
  const ui = page.locator('#chatsweeper-organizer');
  await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('summary').textContent.startsWith('65 total'));
  return { page, ui, records, mutations, switchWorkspace: () => { workspace = 'other'; } };
}
test('organizer searches full history, sorts, paginates, and protects pinned selections', async () => {
  const { page, ui } = await setup();
  try {
    assert.equal(await ui.locator('#rows tr').count(), 40);
    await ui.locator('#next').click(); assert.equal(await ui.locator('#rows tr').count(), 20);
    await ui.locator('#select-matches').click(); assert.equal(await ui.locator('#selected').textContent(), '59 selected');
    await ui.locator('#query').fill('Conversation 03'); assert.equal(await ui.locator('#selected').textContent(), '0 selected');
    assert.equal(await ui.locator('#rows tr').count(), 1);
    await ui.locator('#query').fill(''); await ui.locator('#scope').selectOption('archived');
    assert.equal(await ui.locator('#rows tr').count(), 5);
    await ui.locator('#sort').selectOption('created-asc');
    assert.equal(await ui.locator('#rows .title').first().textContent(), 'Conversation 60');
    await ui.locator('#scope').selectOption('all'); await ui.locator('#query').fill('Conversation 04');
    await ui.locator('#rows .title').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('messages').textContent.includes('Reply for chat-4'));
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await ui.locator('#messages img').count(), 0);
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/organizer-preview.png' });
  } finally { await page.close(); }
});
test('archive/restoration review, cancellation, and undo keep changes explicit', async () => {
  const { page, ui, records, mutations } = await setup();
  try {
    await ui.locator('#query').fill('Conversation 02'); await ui.locator('#select-matches').click();
    await ui.locator('#archive').click(); await ui.locator('#cancel').click(); assert.equal(mutations.length, 0);
    await ui.locator('#archive').click(); await ui.locator('#confirm').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('summary').textContent.includes('6 archived'));
    assert.equal(records[2].is_archived, true);
    await ui.locator('#undo').click(); assert.equal(mutations.length, 1);
    await ui.locator('#confirm').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('summary').textContent.includes('5 archived'));
    assert.equal(records[2].is_archived, false); assert.equal(mutations.length, 2);
    await ui.locator('#query').fill(''); await ui.locator('#scope').selectOption('archived');
    await ui.locator('#select-matches').click(); await ui.locator('#restore').click();
    assert.equal(await ui.locator('#review-list li').count(), 5);
    await ui.locator('#confirm').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('summary').textContent.includes('0 archived'));
    assert.equal(records.filter(r => r.is_archived).length, 0);
  } finally { await page.close(); }
});
test('failed restoration stops the queue and retains remaining selections', async () => {
  const { page, ui, mutations } = await setup({ fail: 'chat-64' });
  try {
    await ui.locator('#scope').selectOption('archived'); await ui.locator('#select-matches').click();
    await ui.locator('#restore').click();
    assert.equal(await ui.locator('#review-list li').first().textContent(), 'Conversation 64');
    await ui.locator('#confirm').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('notice').textContent.includes('Stopped:'));
    await ui.locator('#refresh').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('refresh').disabled);
    assert.equal(mutations.length, 1); assert.equal(await ui.locator('#selected').textContent(), '5 selected');
  } finally { await page.close(); }
});
test('workspace change blocks mutation and old preview responses cannot overwrite newer previews', async () => {
  const { page, ui, mutations, switchWorkspace } = await setup({ slowPreview: 'chat-59' });
  try {
    await ui.locator('#rows .title').nth(0).click(); await ui.locator('#rows .title').nth(1).click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('messages').textContent.includes('chat-58'));
    await page.waitForTimeout(800); assert(!await ui.locator('#messages').textContent().then(t => t.includes('chat-59')));
    await ui.locator('#query').fill('Conversation 02'); await ui.locator('#select-matches').click(); await ui.locator('#archive').click();
    switchWorkspace(); await ui.locator('#confirm').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('notice').textContent.includes('workspace changed'));
    assert.equal(mutations.length, 0);
  } finally { await page.close(); }
});
test('Stop finishes the in-flight restore without processing later chats', async () => {
  const { page, ui, mutations } = await setup({ delay: 400 });
  try {
    await ui.locator('#scope').selectOption('archived'); await ui.locator('#select-matches').click();
    await ui.locator('#restore').click(); await ui.locator('#confirm').click();
    await page.waitForTimeout(150); await ui.locator('#stop').click();
    await page.waitForFunction(() => document.getElementById('chatsweeper-organizer').shadowRoot.getElementById('notice').textContent.includes('Stopped;'));
    assert.equal(mutations.length, 1);
  } finally { await page.close(); }
});
