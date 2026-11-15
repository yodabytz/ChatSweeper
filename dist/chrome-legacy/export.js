(function (root) {
  'use strict';
  async function exportChats(fetcher, ids, workspace, progress, cancelled) {
    async function get(path, headers) {
      if (cancelled()) throw new Error('Export stopped. Nothing was downloaded or deleted.');
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer;
      try {
        return await Promise.race([
          fetcher(path, { credentials: 'same-origin', headers: headers || {}, signal: controller ? controller.signal : undefined }).then(function (r) {
            if (!r.ok) throw new Error('Export failed (HTTP ' + r.status + '). No chats were changed.');
            return r.json();
          }),
          new Promise(function (_, reject) { timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('Export timed out. No chats were changed.')); }, 20000); })
        ]);
      } finally { clearTimeout(timer); }
    }
    var session = await get('/api/auth/session');
    if (!session.accessToken || !session.account || !session.account.id) throw new Error('Sign in to ChatGPT before exporting.');
    if (workspace && session.account.id !== workspace) throw new Error('Your workspace changed. Refresh ChatGPT before exporting.');
    var headers = { Authorization: 'Bearer ' + session.accessToken, 'ChatGPT-Account-Id': session.account.id };
    var conversations = [];
    for (var i = 0; i < ids.length; i++) {
      if (!/^[a-zA-Z0-9-]+$/.test(ids[i])) throw new Error('Invalid conversation ID.');
      progress(i, ids.length);
      var data = await get('/backend-api/conversation/' + encodeURIComponent(ids[i]), headers);
      if (!data || !data.mapping || typeof data.mapping !== 'object' || Array.isArray(data.mapping)) throw new Error('ChatGPT returned an incomplete conversation. Export stopped.');
      if ((data.conversation_id && data.conversation_id !== ids[i]) || (data.id && data.id !== ids[i])) throw new Error('ChatGPT returned a different conversation. Export stopped.');
      // Do not export session credentials or arbitrary account metadata.
      conversations.push({ id: ids[i], title: data.title || '', create_time: data.create_time, update_time: data.update_time, current_node: data.current_node, mapping: data.mapping });
    }
    if (cancelled()) throw new Error('Export stopped. Nothing was downloaded or deleted.');
    progress(ids.length, ids.length);
    return { format: 'ChatSweeper export', version: 1, exported_at: new Date().toISOString(), conversations: conversations };
  }
  root.ChatSweeperExport = { exportChats: exportChats };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChatSweeperExport;
})(typeof window !== 'undefined' ? window : globalThis);
