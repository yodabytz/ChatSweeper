'use strict';
var action = chrome.action || chrome.browserAction;
action.onClicked.addListener(function (tab) {
  chrome.tabs.sendMessage(tab.id, { type: 'chatsweeper-toggle' }, function () {
    if (chrome.runtime.lastError) {
      action.setBadgeText({ tabId: tab.id, text: '↻' });
      action.setTitle({ tabId: tab.id, title: 'Open ChatGPT and refresh the page to start ChatSweeper.' });
    } else {
      action.setBadgeText({ tabId: tab.id, text: '' });
    }
  });
});
