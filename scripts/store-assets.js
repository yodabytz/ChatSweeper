'use strict';
// Capture the actual packaged extension on a labelled, synthetic conversation page.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const dest = path.join(root, 'store/assets');
fs.mkdirSync(dest, { recursive: true });
const chats = [
  ['a', 'Weekend trip to Lisbon', 140, false],
  ['b', 'Quick vegetarian dinners', 12, false],
  ['c', 'Project notes — keep handy', 5, true],
  ['d', 'Summer trip packing list', 220, false],
  ['e', 'Learning Spanish', 22, false],
  ['f', 'Old meeting outline', 410, false],
  ['g', 'Ideas for a rainy afternoon', 45, false],
  ['h', 'Archived brainstorming', 250, false]
].map(([id, title, days, pin]) => ({ id, title, update_time: (Date.now() - days * 86400000) / 1000, is_starred: pin, is_archived: id === 'h' }));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>ChatSweeper demo — sample conversations</title>
<style>*{box-sizing:border-box}body{margin:0;font:15px/1.6 system-ui,sans-serif;color:#263647;background:#fff}nav{position:fixed;inset:0 auto 0 0;width:290px;background:#f5f7fa;padding:28px 18px;overflow:auto;border-right:1px solid #e0e6ed}nav strong{font-size:20px}nav small{display:block;margin:3px 0 36px;color:#586d81}nav .row{display:flex;align-items:center;padding:12px 6px;margin:5px 0;border-radius:8px}nav a{color:inherit;text-decoration:none;flex:1;font-size:13px;display:flex;align-items:center;min-height:30px}nav button{border:0;background:transparent;color:inherit}main{margin-left:290px;padding:48px 42px;width:600px}main small{color:#63788e}h1{font-size:32px;line-height:1.25;margin:48px 0 30px}article{background:#f5f7fa;padding:20px;border-radius:14px}article p{margin:0}aside{font-size:13px;margin-top:26px;color:#63788e}.dark body{background:#161b22;color:#e8eef5}.dark nav,.dark article{background:#202833}.dark nav{border-color:#374354}.dark small,.dark aside{color:#aabbd0}</style>
<nav aria-label="Chat history"><strong>Your conversations</strong><small>Demo data · ChatSweeper preview</small>${chats.filter(c => !c.is_archived).map(c => `<div class="row"><a href="/c/${c.id}" aria-label="${c.title}">${c.title}</a><button aria-label="${c.is_starred ? 'Unpin chat' : 'Chat actions'}">${c.is_starred ? '★' : '⋯'}</button></div>`).join('')}</nav>
<main><small>ChatSweeper · Conversation management</small><h1>A little less clutter.<br>A little more focus.</h1><article><p>This preview uses sample conversations. The ChatSweeper controls are running from the packaged extension.</p></article><aside>Select chats in the sidebar.<br>Review every archive or deletion.<br>Keep a JSON copy when you need one.</aside></main></html>`;

(async () => {
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'chatsweeper-store-')), {
    headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: ['--no-sandbox', '--disable-extensions-except=' + path.join(root, 'dist/chrome'), '--load-extension=' + path.join(root, 'dist/chrome')]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.route('https://chatgpt.com/**', route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/auth/session') return route.fulfill({ json: { accessToken: 'sample-only', account: { id: 'sample-workspace' } } });
      if (u.pathname === '/backend-api/conversations') return route.fulfill({ json: { items: +u.searchParams.get('offset') > 0 ? [] : chats.filter(c => c.is_archived === (u.searchParams.get('is_archived') === 'true')), total: 999 } });
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('https://chatgpt.com/');
    await page.locator('#launcher').waitFor();
    const toggled = await worker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        try { const result = await chrome.tabs.sendMessage(tab.id, { type: 'chatsweeper-toggle' }); if (result) return result.enabled; } catch (_) {}
      }
    });
    if (!toggled) throw Error('Packaged toolbar toggle failed');
    await page.waitForFunction(() => document.getElementById('chatsweeper-root').shadowRoot.getElementById('total').textContent === '8 total chats');
    await page.locator('#all').click();
    await page.screenshot({ path: path.join(dest, '01-select-and-organize-1280x800.png') });
    await page.locator('#search').fill('trip');
    await page.locator('#age').selectOption('90');
    await page.locator('#all').click();
    if (await page.locator('#count').textContent() !== '2 selected') throw Error('Packaged filters failed');
    await page.screenshot({ path: path.join(dest, '02-search-and-age-filters-1280x800.png') });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.locator('#archive').click();
    await page.screenshot({ path: path.join(dest, '03-archive-review-dark-1280x800.png') });
    await page.locator('#cancel').click();
    if (!await page.locator('#export').isEnabled()) throw Error('Export module/UI unavailable');
    if (!await page.evaluate(() => !!document.getElementById('chatsweeper-root'))) throw Error('Content script missing');
    console.log('Packaged Manifest V3 smoke test passed: auto injection, toolbar messaging, count, filters, pin protection, archive review. No real data used.');
    const promo = await context.newPage();
    await promo.setViewportSize({ width: 440, height: 280 });
    const icon = fs.readFileSync(path.join(root, 'extension/icons/128.png')).toString('base64');
    await promo.setContent(`<html><style>*{box-sizing:border-box}body{margin:0;background:#eef4fa;color:#17324d;font-family:system-ui,sans-serif;padding:28px}img{width:80px;height:80px;float:right}h1{font-size:34px;margin:14px 0 12px;letter-spacing:-1px}p{font-size:21px;line-height:1.35;max-width:300px;margin:0}footer{font-size:13px;border-top:1px solid #b5c9dc;margin-top:30px;padding-top:13px}</style><img src="data:image/png;base64,${icon}"><h1>ChatSweeper</h1><p>Make room for your<br>next conversation.</p><footer>Select · Archive · Export · Delete</footer></html>`);
    await promo.screenshot({ path: path.join(dest, 'promo-small-440x280.png') });
    fs.copyFileSync(path.join(root, 'extension/icons/128.png'), path.join(dest, 'store-icon-128.png'));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
