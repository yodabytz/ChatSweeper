'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = path.join(root, 'extension');
const version = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'))).version;
for (const variant of ['chrome', 'chrome-legacy', 'firefox']) {
  const dest = path.join(root, 'dist', variant);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  if (variant === 'firefox') {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ['background.js'] };
    manifest.browser_specific_settings = { gecko: {
      id: 'chatsweeper@yodabytz.github.io',
      strict_min_version: '142.0',
      data_collection_permissions: { required: ['authenticationInfo', 'personallyIdentifyingInfo', 'websiteActivity'] }
    } };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  if (variant === 'chrome-legacy') {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
    manifest.manifest_version = 2;
    manifest.minimum_chrome_version = '61';
    manifest.browser_action = manifest.action;
    delete manifest.action;
    manifest.background = { scripts: ['background.js'], persistent: false };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}
fs.mkdirSync(path.join(root, 'dist', 'min'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'min', 'chatsweeper.user.js'),
  '// ==UserScript==\n// @name ChatSweeper\n// @version ' + version + '\n// @match https://chatgpt.com/*\n// @match https://chat.openai.com/*\n// @run-at document-end\n// ==/UserScript==\n' + ['counts.js', 'export.js', 'history-api.js', 'organizer.js', 'content.js'].map(file => fs.readFileSync(path.join(source, file), 'utf8')).join('\n'));
console.log('Built dist/chrome, dist/chrome-legacy, dist/firefox, and dist/min.');
