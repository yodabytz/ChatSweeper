'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
for (const variant of ['firefox', 'chrome', 'legacy']) {
  test(variant + ' toolbar handles missing content scripts and recovers after refresh', async () => {
    let clicked, fail = true;
    const badges = [], titles = [], messages = [];
    const action = { onClicked: { addListener(fn) { clicked = fn; } }, setBadgeText(value) { badges.push(value); }, setTitle(value) { titles.push(value); } };
    const api = { runtime: {}, tabs: { sendMessage(id, message, callback) {
      messages.push({ id, message });
      if (variant === 'firefox') return fail ? Promise.reject(new Error('No receiver')) : Promise.resolve({ enabled: true });
      api.runtime.lastError = fail ? { message: 'No receiver' } : undefined;
      callback();
    } }, [variant === 'legacy' ? 'browserAction' : 'action']: action };
    vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), { [variant === 'firefox' ? 'browser' : 'chrome']: api });
    clicked({ id: 7 }); await Promise.resolve();
    assert.equal(badges.at(-1).text, '↻'); assert.match(titles.at(-1).title, /refresh/);
    fail = false; clicked({ id: 7 }); await Promise.resolve();
    assert.equal(badges.at(-1).text, ''); assert.equal(titles.at(-1).title, 'Toggle ChatSweeper');
    assert.equal(messages[1].id, 7); assert.equal(messages[1].message.type, 'chatsweeper-toggle');
    clicked({}); assert.equal(messages.length, 2);
  });
}
