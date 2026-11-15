'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
let browser;
before(async () => {
  const downloadsPath = require('node:path').resolve('test-results/downloads');
  fs.mkdirSync(downloadsPath, { recursive: true });
  browser = await chromium.launch({ headless: true, downloadsPath, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser', args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); });
const source = fs.readFileSync('extension/content.js', 'utf8');
async function setup(options = {}) {
  const page = await browser.newPage();
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><nav id="history"></nav><main><a href="/c/message-link">Conversation mentioned in a message</a></main></body></html>' }));
  await page.goto('https://chatgpt.com/');
  await page.evaluate(options => {
    window.deleted = []; window.archived = []; window.chatMeta = {};
    window.addChat = (id, title) => {
      const row = document.createElement('div');
      window.chatMeta[id] = { id, title, update_time: (Date.now() - ((options.ages || {})[id] || 10) * 86400000) / 1000, is_starred: (options.pinned || []).includes(id) };
      row.style.cssText = 'display:flex;padding:12px;width:260px';
      const link = document.createElement('a'); link.href = '/c/' + id; link.textContent = title;
      const menu = document.createElement('button'); menu.setAttribute('aria-haspopup', 'menu'); menu.textContent = '…';
      if (options.nested) {
        row.setAttribute('data-sidebar-cycle-item', '');
        let inner = row;
        for (let i = 0; i < 3; i++) { const wrapper = document.createElement('div'); inner.append(wrapper); inner = wrapper; }
        inner.append(link); row.append(menu);
        link.setAttribute('aria-label', title);
        link.textContent = title + title; // Scrolling title duplicates must not corrupt verification.
      } else { row.append(link, menu); }
      document.querySelector('nav').append(row);
      menu.addEventListener(options.pointer ? 'pointerdown' : 'click', () => {
        if (document.querySelector('[role="menu"]')) return;
        const popup = document.createElement('div'); popup.setAttribute('role', 'menu'); popup.setAttribute('data-state', 'open');
        const del = document.createElement('button'); del.setAttribute('role', 'menuitem'); del.textContent = 'Delete'; popup.append(del); document.body.append(popup);
        const archive = document.createElement('button'); archive.setAttribute('role', 'menuitem'); archive.textContent = 'Archive'; popup.append(archive);
        archive.onclick = () => {
          popup.remove();
          if (!options.failArchive) { window.archived.push(id); row.remove(); }
        };
        del.onclick = () => {
          popup.remove();
          const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
          const titleNode = document.createElement('p'); titleNode.textContent = 'Delete chat? ' + (options.wrongTitle ? 'Unrelated conversation' : title);
          const confirm = document.createElement('button'); confirm.textContent = 'Delete';
          dialog.append(titleNode, confirm); document.body.append(dialog);
          confirm.onclick = () => {
            if (options.fail) { dialog.remove(); return; }
            setTimeout(() => { window.deleted.push(id); row.remove(); dialog.remove(); }, options.delay || 0);
          };
        };
      });
    };
    addChat('a', 'Trip plans'); addChat('b', 'Recipe <ideas>'); addChat('c', 'Keep this one');
    if (options.nonmodal) {
      const floating = document.createElement('section'); floating.setAttribute('role', 'dialog'); floating.setAttribute('aria-modal', 'false');
      floating.textContent = 'Floating chat'; document.body.append(floating);
    }
  }, options);
  await page.route('https://chatgpt.com/api/auth/session', route => route.fulfill({ json: { accessToken: 'fixture-token', account: { id: 'fixture-workspace' } } }));
  await page.route('https://chatgpt.com/backend-api/conversations?**', async route => {
    const query = new URL(route.request().url()).searchParams;
    const items = +query.get('offset') > 0 ? [] : await page.evaluate(archive => Object.values(window.chatMeta).filter(m => !window.deleted.includes(m.id) && window.archived.includes(m.id) === archive), query.get('is_archived') === 'true');
    await route.fulfill({ json: { items, total: items.length + 1 } });
  });
  await page.route('https://chatgpt.com/backend-api/conversation/*', route => {
    if (options.failExport) return route.fulfill({ status: 500, json: { error: 'Fixture failure' } });
    const id = route.request().url().split('/').pop();
    return route.fulfill({ json: { conversation_id: id, title: 'Export ' + id, mapping: { root: { message: { author: { role: 'user' }, content: { parts: ['Test content'] } } } } } });
  });
  await page.addScriptTag({ content: fs.readFileSync('extension/counts.js', 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync('extension/export.js', 'utf8') });
  await page.addScriptTag({ content: source });
  await page.locator('#launcher').click();
  return page;
}
test('selection is scoped to history; cancel never deletes; SPA additions and reinjection are safe', async () => {
  const page = await setup();
  try {
    assert.equal(await page.locator('.chatsweeper-checkbox').count(), 3);
    await page.locator('a[href="/c/a"] input').check();
    assert.equal(new URL(page.url()).pathname, '/');
    await page.locator('#review').click(); await page.locator('#cancel').click();
    assert.deepEqual(await page.evaluate(() => deleted), []);
    await page.evaluate(() => addChat('d', 'Newly loaded'));
    await page.waitForSelector('a[href="/c/d"] input');
    await page.locator('#refresh-count').click();
    await page.locator('#all').click();
    assert.equal(await page.locator('#count').textContent(), '4 selected');
    await page.addScriptTag({ content: source });
    assert.equal(await page.locator('#chatsweeper-root').count(), 1);
    await page.locator('#close').click();
    assert.equal(await page.locator('.chatsweeper-checkbox').count(), 0);
  } finally { await page.close(); }
});
for (const pointer of [false, true]) test('deletes only reviewed chats with ' + (pointer ? 'Radix pointer' : 'click') + ' menus', async () => {
  const page = await setup({ pointer });
  try {
    await page.locator('a[href="/c/a"] input').check();
    await page.locator('a[href="/c/b"] input').check();
    await page.locator('#review').click();
    assert.equal(await page.locator('#titles li').count(), 2);
    assert.equal(await page.locator('#titles li').nth(1).textContent(), 'Recipe <ideas>');
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Finished.'));
    assert.deepEqual(await page.evaluate(() => deleted), ['a', 'b']);
    assert.equal(await page.locator('a[href="/c/c"]').count(), 1);
  } finally { await page.close(); }
});
test('wrong dialog title stops without confirming deletion', async () => {
  const page = await setup({ wrongTitle: true });
  try {
    await page.locator('#all').click(); await page.locator('#review').click(); await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Could not verify'));
    assert.deepEqual(await page.evaluate(() => deleted), []);
    assert.equal(await page.locator('#count').textContent(), '3 selected');
  } finally { await page.close(); }
});
test('failed deletion retains selection and stops the queue', async () => {
  const page = await setup({ fail: true });
  try {
    await page.locator('#all').click(); await page.locator('#review').click(); await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Deletion was not confirmed'), { timeout: 12000 });
    assert.deepEqual(await page.evaluate(() => deleted), []);
    assert.equal(await page.locator('#count').textContent(), '3 selected');
  } finally { await page.close(); }
});
test('Stop finishes the in-flight chat and preserves remaining selection', async () => {
  const page = await setup({ delay: 500 });
  try {
    await page.locator('#all').click(); await page.locator('#review').click(); await page.locator('#confirm').click();
    await page.waitForSelector('[role="dialog"]'); await page.locator('#stop').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('remaining chats'));
    assert.deepEqual(await page.evaluate(() => deleted), ['a']);
    assert.equal(await page.locator('#count').textContent(), '2 selected');
  } finally { await page.close(); }
});
test('current ChatGPT nested rows work alongside a nonmodal floating chat', async () => {
  const page = await setup({ nested: true, pointer: true, nonmodal: true });
  try {
    await page.locator('a[href="/c/a"] input').check();
    await page.locator('#review').click();
    assert.equal(await page.locator('#titles li').textContent(), 'Trip plans');
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Finished.'));
    assert.deepEqual(await page.evaluate(() => deleted), ['a']);
    assert.equal(await page.locator('[role="dialog"][aria-modal="false"]').count(), 1);
  } finally { await page.close(); }
});
test('popup displays total and loaded counts and refreshes after deletion', async () => {
  const page = await setup();
  try {
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#total').textContent === '3 total chats');
    assert.equal(await page.locator('#loaded').textContent(), '3 loaded in sidebar');
    await page.locator('a[href="/c/a"] input').check();
    await page.locator('#review').click(); await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#total').textContent === '2 total chats');
    assert.equal(await page.locator('#breakdown').textContent(), '2 active · 0 archived · Current workspace');
    assert.equal(await page.locator('#loaded').textContent(), '2 loaded in sidebar');
  } finally { await page.close(); }
});
test('title search and age filters combine, clear old selections, and protect pinned chats', async () => {
  const page = await setup({ ages: { a: 100, b: 400, c: 5 }, pinned: ['b'] });
  try {
    await page.locator('#all').click();
    assert.equal(await page.locator('#count').textContent(), '2 selected');
    assert.equal(await page.locator('a[href="/c/b"] input').isDisabled(), true);
    await page.locator('#search').fill('TRIP');
    assert.equal(await page.locator('#count').textContent(), '0 selected');
    await page.locator('#age').selectOption('90');
    await page.locator('#all').click();
    assert.equal(await page.locator('#count').textContent(), '1 selected');
    await page.locator('#review').click();
    assert.equal(await page.locator('#titles').textContent(), 'Trip plans');
    await page.locator('#cancel').click();
    await page.locator('#age').selectOption('365');
    await page.locator('#all').click();
    assert.equal(await page.locator('#count').textContent(), '0 selected');
    await page.locator('#search').fill('recipe');
    await page.locator('#protect').uncheck();
    await page.locator('#all').click();
    assert.equal(await page.locator('#count').textContent(), '1 selected');
    assert.equal(await page.locator('a[href="/c/b"] input').isChecked(), true);
  } finally { await page.close(); }
});
test('archive review can be cancelled and archive does not delete chats', async () => {
  const page = await setup({ pointer: true, pinned: ['c'] });
  try {
    await page.locator('#all').click(); await page.locator('#archive').click();
    assert.equal(await page.locator('#confirmation h2').textContent(), 'Archive these chats?');
    await page.locator('#cancel').click();
    assert.deepEqual(await page.evaluate(() => archived), []);
    await page.locator('#archive').click(); await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#breakdown').textContent === '1 active · 2 archived · Current workspace');
    assert.deepEqual(await page.evaluate(() => archived), ['a', 'b']);
    assert.deepEqual(await page.evaluate(() => deleted), []);
    assert.equal(await page.locator('#total').textContent(), '3 total chats');
    assert.equal(await page.locator('#progress-text').textContent(), '2 of 2 archived');
    assert.equal(await page.locator('a[href="/c/c"]').count(), 1);
  } finally { await page.close(); }
});
test('archive failure is listed and the rest of the queue is not attempted', async () => {
  const page = await setup({ failArchive: true });
  try {
    await page.locator('#all').click(); await page.locator('#archive').click(); await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Archiving was not confirmed'));
    assert.match(await page.locator('#results').textContent(), /Trip plans — Failed/);
    assert.match(await page.locator('#results').textContent(), /2 later chats were not attempted/);
    assert.deepEqual(await page.evaluate(() => archived), []);
  } finally { await page.close(); }
});
test('export before deletion downloads only selected chats and requires a second confirmation', async () => {
  const page = await setup();
  try {
    await page.locator('a[href="/c/a"] input').check();
    await page.locator('#backup').check(); await page.locator('#review').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#confirm').click();
    const download = await downloadEvent;
    const content = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(content.conversations.map(c => c.id), ['a']);
    assert.equal(content.conversations[0].mapping.root.message.content.parts[0], 'Test content');
    assert(!JSON.stringify(content).includes('fixture-token'));
    assert.deepEqual(await page.evaluate(() => deleted), []);
    assert.match(await page.locator('#confirmation p').textContent(), /Check that the JSON export is saved/);
    await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Finished.'));
    assert.deepEqual(await page.evaluate(() => deleted), ['a']);
  } finally { await page.close(); }
});
test('failed backup blocks deletion', async () => {
  const page = await setup({ failExport: true });
  try {
    await page.locator('a[href="/c/a"] input').check();
    await page.locator('#backup').check(); await page.locator('#review').click(); await page.locator('#confirm').click();
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#status').textContent.includes('Export failed'));
    assert.deepEqual(await page.evaluate(() => deleted), []);
    assert.equal(await page.locator('#confirmation').isVisible(), true);
  } finally { await page.close(); }
});
test('Load older chats scrolls only the sidebar and discovers the next batch', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => {
      const nav = document.querySelector('nav'); nav.style.cssText = 'height:80px;overflow-y:auto';
      nav.addEventListener('scroll', () => { if (!window.chatMeta.d) addChat('d', 'Older conversation'); }, { once: true });
    });
    await page.locator('#load-older').click();
    await page.waitForSelector('a[href="/c/d"] input');
    await page.waitForFunction(() => document.querySelector('#chatsweeper-root').shadowRoot.querySelector('#total').textContent === '4 total chats');
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.locator('#loaded').textContent(), '4 loaded in sidebar');
  } finally { await page.close(); }
});
test('dark mode follows ChatGPT and supports an explicit appearance choice', async () => {
  const page = await setup();
  try {
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForFunction(() => document.getElementById('chatsweeper-root').getAttribute('data-theme') === 'dark');
    assert.equal(await page.locator('#panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(32, 37, 44)');
    await page.screenshot({ path: 'test-results/chatsweeper-dark.png' });
    await page.locator('#theme').selectOption('light');
    assert.equal(await page.locator('#panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    await page.screenshot({ path: 'test-results/chatsweeper-light.png' });
  } finally { await page.close(); }
});
