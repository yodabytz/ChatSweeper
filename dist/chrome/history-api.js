(function (root) {
  'use strict';
  function validId(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid conversation ID.');
    return encodeURIComponent(id);
  }
  async function request(fetcher, url, options) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null, timer;
    try {
      return await Promise.race([
        fetcher(url, Object.assign({ credentials: 'same-origin', signal: controller ? controller.signal : undefined }, options || {})).then(async function (response) {
          if (!response.ok) throw new Error(response.status === 429 ? 'ChatGPT is rate limiting requests. Wait before trying again.' : 'ChatGPT returned HTTP ' + response.status + '. Refresh and check the chat before retrying.');
          return response.json();
        }),
        new Promise(function (_, reject) { timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('Request timed out. Its outcome may be unknown; refresh before retrying.')); }, 20000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function session(fetcher, workspace) {
    var data = await request(fetcher, '/api/auth/session');
    if (!data.accessToken || !data.account || !data.account.id) throw new Error('Sign in to ChatGPT and refresh the organizer.');
    if (!workspace || data.account.id !== workspace) throw new Error('Your workspace changed. Refresh the organizer before continuing.');
    return { Authorization: 'Bearer ' + data.accessToken, 'ChatGPT-Account-Id': data.account.id };
  }
  function verify(data, id) {
    if (!data || typeof data !== 'object' || !data.mapping || typeof data.mapping !== 'object' || Array.isArray(data.mapping)) throw new Error('ChatGPT returned an incomplete conversation.');
    if ((data.conversation_id && data.conversation_id !== id) || (data.id && data.id !== id)) throw new Error('ChatGPT returned a different conversation.');
  }
  async function conversation(fetcher, id, workspace) {
    var path = '/backend-api/conversation/' + validId(id);
    var headers = await session(fetcher, workspace);
    var data = await request(fetcher, path, { headers: headers }); verify(data, id);
    return data;
  }
  function preview(data) {
    var mapping = data.mapping, node = mapping[data.current_node], visited = new Set(), messages = [];
    if (!node) throw new Error('The current conversation branch is unavailable. Open the chat to read it.');
    while (node && messages.length < 8 && visited.size < 2000) {
      var key = node.id || Object.keys(mapping).find(function (id) { return mapping[id] === node; });
      if (visited.has(key)) throw new Error('The conversation contains an invalid message chain.');
      visited.add(key);
      var message = node.message;
      if (message && message.author && /^(user|assistant)$/.test(message.author.role) && !(message.metadata && message.metadata.is_visually_hidden_from_conversation)) {
        var content = message.content || {}, parts = Array.isArray(content.parts) ? content.parts : [];
        var text = parts.map(function (part) { return typeof part === 'string' ? part : '[Attachment or non-text content]'; }).join('\n');
        if (!text && typeof content.text === 'string') text = content.text;
        if (text) messages.push({ role: message.author.role, text: text.length > 2400 ? text.slice(0, 2400) + '\n[Excerpt truncated]' : text });
      }
      node = node.parent ? mapping[node.parent] : null;
    }
    return messages.reverse();
  }
  async function change(fetcher, item, action, workspace, protectPinned) {
    if (!['archive', 'restore', 'delete'].includes(action)) throw new Error('Unknown chat action.');
    var path = '/backend-api/conversation/' + validId(item.id);
    var headers = await session(fetcher, workspace);
    var before = await request(fetcher, path, { headers: headers }); verify(before, item.id);
    if (typeof before.is_archived !== 'boolean') throw new Error('Could not verify this chat’s archive status. No change sent.');
    if ((before.title || 'Untitled chat') !== item.title) throw new Error('This chat was renamed. Refresh and review its new title.');
    if (protectPinned && action !== 'restore' && (item.pinned || before.is_starred || before.pinned_time)) throw new Error('Pinned-chat protection stopped this action.');
    if (before.is_archived !== item.archived) throw new Error('This chat’s archive status changed. Refresh and review it again.');
    if ((action === 'archive' && before.is_archived) || (action === 'restore' && !before.is_archived)) throw new Error('The requested archive state already exists. Refresh the organizer.');
    var body = action === 'delete' ? { is_visible: false } : { is_archived: action === 'archive' };
    var response = await request(fetcher, path, { method: 'PATCH', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (!response || response.success !== true) throw new Error('ChatGPT did not confirm the change. Refresh before trying again.');
    if (action !== 'delete') {
      var after = await request(fetcher, path, { headers: headers }); verify(after, item.id);
      if (after.is_archived !== (action === 'archive')) throw new Error('The archive state was not confirmed. Refresh before retrying.');
    }
    return { id: item.id, action: action };
  }
  function timestamp(value) {
    if (value == null || value === '') return NaN;
    return typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  }
  function filter(items, options) {
    var q = (options.query || '').trim().toLocaleLowerCase();
    var filtered = items.filter(function (item) {
      if (options.scope === 'active' && item.archived || options.scope === 'archived' && !item.archived) return false;
      if (q && item.title.toLocaleLowerCase().indexOf(q) < 0) return false;
      var time = timestamp(item.updated);
      return !options.days || (Number.isFinite(time) && time < (options.now || Date.now()) - options.days * 86400000);
    });
    var sort = options.sort || 'updated-desc', descending = /desc$/.test(sort), field = sort.split('-')[0];
    filtered.sort(function (a, b) {
      var result;
      if (field === 'title') result = a.title.localeCompare(b.title);
      else {
        var at = timestamp(a[field]), bt = timestamp(b[field]);
        if (!Number.isFinite(at)) return Number.isFinite(bt) ? 1 : a.id.localeCompare(b.id);
        if (!Number.isFinite(bt)) return -1;
        result = at - bt;
      }
      return (descending ? -result : result) || a.id.localeCompare(b.id);
    });
    return filtered;
  }
  root.ChatSweeperHistory = { conversation: conversation, preview: preview, change: change, filter: filter, timestamp: timestamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChatSweeperHistory;
})(typeof window !== 'undefined' ? window : globalThis);
