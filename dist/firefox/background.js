'use strict';
var extensionApi = typeof browser !== 'undefined' ? browser : chrome;
var action = extensionApi.action || extensionApi.browserAction;
function showStatus(tabId, failed) {
  action.setBadgeText({ tabId: tabId, text: failed ? '↻' : '' });
  action.setTitle({ tabId: tabId, title: failed ? 'Open ChatGPT and refresh the page to start ChatSweeper.' : 'Toggle ChatSweeper' });
}
action.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== 'number') return;
  if (typeof browser !== 'undefined') {
    extensionApi.tabs.sendMessage(tab.id, { type: 'chatsweeper-toggle' }).then(function () {
      showStatus(tab.id, false);
    }, function () { showStatus(tab.id, true); });
  } else {
    extensionApi.tabs.sendMessage(tab.id, { type: 'chatsweeper-toggle' }, function () {
      showStatus(tab.id, !!extensionApi.runtime.lastError);
    });
  }
});
