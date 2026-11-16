// ==UserScript==
// @name ChatSweeper
// @version 0.4.1
// @match https://chatgpt.com/*
// @match https://chat.openai.com/*
// @run-at document-end
// ==/UserScript==
(function (root) {
  'use strict';
  // ChatGPT's `total` is sometimes only offset + page size + 1. Count IDs
  // across complete lists instead; never present that pagination hint as a total.
  async function countChats(fetcher, progress, cancelled) {
    async function get(path, headers) {
      if (cancelled()) throw new Error('Count cancelled.');
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer;
      try {
        return await Promise.race([
          fetcher(path, { credentials: 'same-origin', headers: headers || {}, signal: controller ? controller.signal : undefined }).then(function (r) {
            if (!r.ok) throw new Error(r.status === 429 ? 'ChatGPT is rate limiting requests. Try again later.' : 'ChatGPT could not provide the count (HTTP ' + r.status + '). Refresh the page and try again.');
            return r.json();
          }),
          new Promise(function (_, reject) { timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('The count request timed out. Try again.')); }, 15000); })
        ]);
      } finally { clearTimeout(timer); }
    }
    var session = await get('/api/auth/session');
    if (!session.accessToken || !session.account || !session.account.id) throw new Error('Sign in to ChatGPT, then refresh the count.');
    var headers = { Authorization: 'Bearer ' + session.accessToken, 'ChatGPT-Account-Id': session.account.id };
    var active = new Set(), archived = new Set(), details = new Map();
    for (var archiveFlag of [false, true]) {
      for (var source of ['exclude_conversation_origin=tpp', 'conversation_origin=tpp']) {
        for (var starred of [false, true]) {
          var offset = 0, seen = new Set(), finished = false;
          for (var page = 0; page < 1000; page++) {
            var data = await get('/backend-api/conversations?' + source + '&expand=false&hide_snorlax=false&is_archived=' + archiveFlag + '&is_starred=' + starred + '&limit=100&order=updated&offset=' + offset, headers);
            if (!Array.isArray(data.items)) throw new Error('ChatGPT returned an unexpected chat list.');
            if (!data.items.length) { finished = true; break; }
            var added = 0;
            data.items.forEach(function (item) {
              if (!item || typeof item.id !== 'string' || !item.id) throw new Error('ChatGPT returned a chat without an ID.');
              if (!seen.has(item.id)) { seen.add(item.id); added++; }
              (archiveFlag ? archived : active).add(item.id);
              var previous = details.get(item.id);
              details.set(item.id, {
                id: item.id,
                title: typeof item.title === 'string' ? item.title : '',
                updated: item.update_time,
                created: item.create_time,
                pinned: !!(item.pinned_time || item.is_starred || (previous && previous.pinned))
              });
            });
            if (!added) throw new Error('ChatGPT repeated a page. The count is incomplete; try again.');
            offset += data.items.length;
            progress(new Set(Array.from(active).concat(Array.from(archived))).size);
            // Do not trust `total` or a short page: query until the list is empty.
          }
          if (!finished) throw new Error('The chat list is too large to finish counting in this pass.');
        }
      }
    }
    active.forEach(function (id) { archived.delete(id); });
    return { active: active, archived: archived, details: details, workspace: session.account.id };
  }
  root.ChatSweeperCounts = { countChats: countChats };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChatSweeperCounts;
})(typeof window !== 'undefined' ? window : globalThis);

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

(function (root) {
  'use strict';
  var host, ui, rows = [], chosen = new Set(), snapshot, busy = false, loading = false, valid = false;
  var page = 0, generation = 0, previewGeneration = 0, stop = false, review = null, undo = [], returnFocus, onChanged;
  var api = root.ChatSweeperHistory, pageSize = 40;
  function $(id) { return ui.getElementById(id); }
  function element(tag, text, className) { var el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  function selected() { return matches().filter(function (r) { return chosen.has(r.id); }); }
  function matches() { return api.filter(rows, { scope: $('scope').value, query: $('query').value, sort: $('sort').value, days: Number($('days').value) }); }
  function protectedItem(item) { return $('protect-pins').checked && item.pinned; }
  function pickable(item) { return !protectedItem(item) || item.archived; }
  function status(message, error) { $('notice').textContent = message; $('notice').classList.toggle('error', !!error); }
  function date(value) { var time = api.timestamp(value); return Number.isFinite(time) ? new Date(time).toLocaleDateString() : 'Unknown'; }
  function theme() {
    var dark = document.documentElement.classList.contains('dark') || document.documentElement.getAttribute('data-theme') === 'dark';
    var mini = document.getElementById('chatsweeper-root');
    if (mini && mini.hasAttribute('data-theme')) dark = mini.getAttribute('data-theme') === 'dark';
    host.setAttribute('data-dark', String(dark));
  }
  function create() {
    host = element('div'); host.id = 'chatsweeper-organizer';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    ui = host.attachShadow({ mode: 'open' });
    ui.innerHTML = '<style>' +
      ':host{--bg:#fff;--soft:#f3f7fb;--ink:#17324d;--muted:#566b7f;--border:#c9d6e2;--accent:#175d98;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}:host([data-dark="true"]){--bg:#20252c;--soft:#2b333d;--ink:#edf3fa;--muted:#b9c7d7;--border:#4d5969;--accent:#408dce;color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}.veil{position:absolute;inset:0;background:#101c2d99;display:flex;align-items:center;justify-content:center;padding:24px}.window{width:1160px;max-width:100%;height:calc(100vh - 48px);max-height:900px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 60px #0004;display:flex;flex-direction:column;overflow:hidden}header{padding:18px 22px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border)}h1{font-size:22px;line-height:1.2;margin:0}h2{font-size:17px;margin:0 0 10px}p{margin:6px 0 10px}#summary,.muted{color:var(--muted);font-size:12px}.grow{flex:1}button,input,select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:7px 10px}button{cursor:pointer}button:hover{background:var(--soft)}button:disabled{opacity:.45;cursor:default}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent)}.toolbar{display:flex;gap:12px;padding:12px 22px;flex-wrap:wrap;background:var(--soft);border-bottom:1px solid var(--border)}label{font-size:12px;color:var(--muted)}label input:not([type=checkbox]),label select{display:block;margin-top:3px;max-width:100%}.query{flex:1;min-width:170px}.query input{width:100%}.selection{padding:9px 22px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;border-bottom:1px solid var(--border)}.check{display:flex;gap:6px;align-items:center}.selection button{font-size:12px}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 320px;flex:1;min-height:0}.list{display:flex;flex-direction:column;min-height:0;min-width:0}.scroll{overflow:auto;flex:1}table{width:100%;border-collapse:collapse;text-align:left}th{position:sticky;top:0;background:var(--bg);font-size:11px;font-weight:600;color:var(--muted);padding:10px;border-bottom:1px solid var(--border)}td{padding:9px 10px;border-bottom:1px solid var(--border);font-size:12px}td:first-child{width:35px}tr.picked{background:var(--soft)}.title{display:block;border:0;background:transparent;text-align:left;padding:0;color:var(--ink);font-size:14px;word-break:break-word}.badge{font-size:10px;color:var(--muted);margin-right:8px}.dates{white-space:nowrap}.pager{padding:10px 14px;display:flex;gap:9px;align-items:center;border-top:1px solid var(--border);font-size:12px}.preview{border-left:1px solid var(--border);padding:18px;overflow:auto;background:var(--soft)}.preview article{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;margin:12px 0}.preview pre{font:13px/1.6 inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}.preview strong{font-size:11px;color:var(--muted)}#open-chat{color:var(--accent)}footer{padding:12px 22px;border-top:1px solid var(--border)}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.danger{background:#ac2636;color:#fff;border-color:#ac2636}#notice{font-size:12px;color:var(--muted);margin:9px 0 0}.error{color:#b83346!important}.confirm-wrap{position:absolute;inset:0;background:#14203388;display:flex;align-items:center;justify-content:center;padding:18px}.confirm{background:var(--bg);padding:24px;border:1px solid var(--border);border-radius:12px;max-width:520px;width:100%;max-height:85vh;overflow:auto}#review-list{max-height:230px;overflow:auto;word-break:break-word}progress{width:100%;height:8px;accent-color:var(--accent)}#results{max-height:80px;overflow:auto;margin:4px 0;padding-left:20px;font-size:12px}#empty{padding:24px;color:var(--muted)}@media(max-width:800px){.veil{padding:8px}.window{height:calc(100vh - 16px)}.workspace{grid-template-columns:minmax(0,1fr) 260px}.dates{display:none}header,.toolbar,.selection,footer{padding:10px}}@media(max-width:580px){.workspace{display:flex;flex-direction:column}.list{flex:1;min-height:180px}.preview{max-height:180px;border-left:0;border-top:1px solid var(--border)}h1{font-size:18px}.toolbar{gap:6px}.toolbar select{max-width:145px}}' +
      '</style><div class="veil"><section class="window" role="dialog" aria-modal="true" aria-labelledby="heading"><header><div class="grow"><h1 id="heading">Your chat library</h1><div id="summary">ChatSweeper · Full history in the current workspace</div></div><button id="refresh">Refresh</button><button id="close" aria-label="Close organizer">✕</button></header>' +
      '<div class="toolbar"><label class="query">Search all chat titles<input id="query" type="search" placeholder="Find a conversation…" autocomplete="off"></label><label>Show<select id="scope"><option value="active">Active chats</option><option value="archived">Archived chats</option><option value="all">All chats</option></select></label><label>Last updated<select id="days"><option value="0">Any time</option><option value="30">Over 30 days ago</option><option value="90">Over 90 days ago</option><option value="365">Over a year ago</option></select></label><label>Sort<select id="sort"><option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest update</option><option value="created-desc">Newest created</option><option value="created-asc">Oldest created</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label></div>' +
      '<div class="selection"><strong id="selected">0 selected</strong><button id="select-matches">Select all matches</button><button id="clear">Clear</button><label class="check"><input id="protect-pins" type="checkbox" checked>Protect pinned chats</label><span class="grow"></span><span id="matched" class="muted"></span></div>' +
      '<div class="workspace"><div class="list"><div class="scroll"><table><thead><tr><th aria-label="Select"></th><th>Conversation</th><th class="dates">Created</th><th class="dates">Updated</th></tr></thead><tbody id="rows"></tbody></table><div id="empty" hidden></div></div><div class="pager"><button id="previous">Previous</button><span id="page"></span><button id="next">Next</button></div></div><aside class="preview"><h2 id="preview-title">Conversation preview</h2><p id="preview-note" class="muted">Click a conversation title to read an excerpt before selecting it.</p><a id="open-chat" hidden target="_blank" rel="noopener noreferrer">Open in ChatGPT</a><div id="messages"></div></aside></div>' +
      '<footer><div class="actions"><button id="archive">Archive selected</button><button id="restore">Restore selected</button><button id="export">Export selected</button><button id="delete" class="danger">Delete selected</button><button id="undo" hidden>Undo last archive</button><button id="stop" hidden>Stop after current chat</button></div><div id="batch" hidden><p id="progress-text"></p><progress id="progress" max="1" value="0"></progress><ul id="results"></ul></div><p id="notice" role="status" aria-live="polite"></p></footer></section></div>' +
      '<div id="review" class="confirm-wrap" hidden><section class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="review-title"><h2 id="review-title"></h2><p id="review-note"></p><ul id="review-list"></ul><div class="actions"><button id="cancel">Go back</button><button id="confirm">Confirm</button></div></section></div>';
    document.documentElement.appendChild(host);
    $('close').onclick = close;
    $('refresh').onclick = function () { refresh(); };
    ['query', 'scope', 'days', 'sort', 'protect-pins'].forEach(function (id) {
      $(id).addEventListener(id === 'query' ? 'input' : 'change', function () { chosen.clear(); page = 0; draw(); });
    });
    $('select-matches').onclick = function () { matches().filter(pickable).forEach(function (item) { chosen.add(item.id); }); draw(); };
    $('clear').onclick = function () { chosen.clear(); draw(); };
    $('previous').onclick = function () { page--; draw(); }; $('next').onclick = function () { page++; draw(); };
    ['archive', 'restore', 'delete'].forEach(function (action) { $(action).onclick = function () { confirmAction(action, selected()); }; });
    $('cancel').onclick = function () { review = null; $('review').hidden = true; controls(); $('query').focus(); };
    $('confirm').onclick = run;
    $('stop').onclick = function () { stop = true; $('stop').disabled = true; status('Stopping after the current request finishes.'); };
    $('undo').onclick = function () {
      var items = rows.filter(function (r) { return r.archived && undo.indexOf(r.id) !== -1; });
      if (!items.length) { undo = []; controls(); status('No chats from the last archive batch remain archived.'); return; }
      confirmAction('restore', items);
    };
    $('export').onclick = exportSelection;
    ui.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !busy) { if (review) $('cancel').click(); else close(); event.preventDefault(); }
      if (event.key === 'Tab') {
        var scope = review ? $('review') : ui;
        var targets = Array.from(scope.querySelectorAll('button,input,select,a[href]')).filter(function (el) { return !el.disabled && el.getClientRects().length; });
        var first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && ui.activeElement === first) { last.focus(); event.preventDefault(); }
        else if (!event.shiftKey && ui.activeElement === last) { first.focus(); event.preventDefault(); }
      }
    });
    window.addEventListener('beforeunload', function (event) { if (busy) { event.preventDefault(); event.returnValue = ''; } });
    new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  }
  function controls() {
    var items = selected(), locked = busy || loading || !valid || !!review;
    ['query', 'scope', 'days', 'sort', 'protect-pins', 'select-matches', 'clear', 'refresh'].forEach(function (id) { $(id).disabled = busy || loading || !!review || (!valid && id !== 'refresh'); });
    $('archive').disabled = locked || !items.length || items.some(function (i) { return i.archived || protectedItem(i); });
    $('restore').disabled = locked || !items.length || items.some(function (i) { return !i.archived; });
    $('delete').disabled = locked || !items.length || items.some(protectedItem);
    $('export').disabled = locked || !items.length;
    $('undo').hidden = !undo.length; $('undo').disabled = locked;
    $('close').disabled = busy; $('stop').hidden = !busy;
    $('selected').textContent = chosen.size + ' selected';
    $('previous').disabled = locked || page <= 0;
    $('next').disabled = locked || (page + 1) * pageSize >= matches().length;
    ui.querySelectorAll('#rows input').forEach(function (box) { box.disabled = locked || !pickable(rows.find(function (r) { return r.id === box.dataset.id; })); });
    ui.querySelectorAll('#rows .title').forEach(function (button) { button.disabled = busy || !!review; });
  }
  function draw() {
    var filtered = matches(), pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    $('rows').textContent = ''; $('matched').textContent = filtered.length + ' matching chats';
    $('page').textContent = 'Page ' + (page + 1) + ' of ' + pages;
    $('empty').hidden = filtered.length > 0;
    $('empty').textContent = loading ? 'Loading full history…' : valid ? 'No chats match these filters.' : 'Refresh to load your conversation library.';
    filtered.slice(page * pageSize, (page + 1) * pageSize).forEach(function (item) {
      var tr = element('tr', undefined, chosen.has(item.id) ? 'picked' : '');
      var cell = element('td'), box = element('input'); box.type = 'checkbox'; box.dataset.id = item.id;
      box.setAttribute('aria-label', 'Select ' + item.title); box.checked = chosen.has(item.id);
      box.title = !pickable(item) ? 'Pinned chat protected' : 'Select conversation';
      box.onchange = function () { if (box.checked) chosen.add(item.id); else chosen.delete(item.id); tr.classList.toggle('picked', box.checked); controls(); };
      cell.appendChild(box); tr.appendChild(cell);
      cell = element('td'); var title = element('button', item.title, 'title'); title.onclick = function () { showPreview(item); }; cell.appendChild(title);
      if (item.archived) cell.appendChild(element('span', 'Archived', 'badge'));
      if (item.pinned) cell.appendChild(element('span', 'Pinned', 'badge'));
      tr.appendChild(cell); tr.appendChild(element('td', date(item.created), 'dates')); tr.appendChild(element('td', date(item.updated), 'dates'));
      $('rows').appendChild(tr);
    });
    controls();
  }
  function clearPreview() {
    previewGeneration++; $('messages').textContent = ''; $('preview-title').textContent = 'Conversation preview';
    $('preview-note').textContent = 'Click a title to read an excerpt. Previews are loaded only when requested.'; $('open-chat').hidden = true;
  }
  async function refresh(preserveNotice) {
    if (loading || busy) return false;
    var runId = ++generation; loading = true; valid = false; chosen.clear(); clearPreview(); draw();
    if (!preserveNotice) status('Loading active and archived conversations…');
    try {
      var data = await root.ChatSweeperCounts.countChats(root.fetch.bind(root), function (n) { if (runId === generation) $('summary').textContent = 'Loading full history… ' + n + ' chats found'; }, function () { return runId !== generation; });
      if (runId !== generation) return false;
      if (snapshot && snapshot.workspace !== data.workspace) undo = [];
      snapshot = data;
      rows = Array.from(data.details.values()).map(function (r) { return Object.assign({}, r, { title: r.title || 'Untitled chat', archived: data.archived.has(r.id) }); });
      valid = true;
      $('summary').textContent = rows.length + ' total · ' + data.active.size + ' active · ' + data.archived.size + ' archived · Current workspace';
      if (!preserveNotice) status('Full history loaded. Selection includes matches across every page.');
      return true;
    } catch (error) {
      if (runId === generation) { status(error.message, true); $('summary').textContent = 'History unavailable — refresh to try again'; }
      return false;
    } finally { if (runId === generation) { loading = false; draw(); } }
  }
  async function showPreview(item) {
    var requestId = ++previewGeneration;
    $('preview-title').textContent = item.title; $('messages').textContent = ''; $('preview-note').textContent = 'Loading preview…'; $('open-chat').hidden = true;
    try {
      var data = await api.conversation(root.fetch.bind(root), item.id, snapshot.workspace);
      if (requestId !== previewGeneration || host.hidden) return;
      var messages = api.preview(data);
      $('preview-note').textContent = messages.length ? 'Latest messages from the current branch. Excerpts may be shortened; attachments are not downloaded.' : 'No text messages are available for preview.';
      messages.forEach(function (message) { var article = element('article'); article.appendChild(element('strong', message.role === 'user' ? 'You' : 'Assistant')); article.appendChild(element('pre', message.text)); $('messages').appendChild(article); });
      $('open-chat').href = location.origin + '/c/' + encodeURIComponent(item.id); $('open-chat').hidden = false;
    } catch (error) { if (requestId === previewGeneration) $('preview-note').textContent = error.message; }
  }
  function confirmAction(action, items) {
    if (busy || loading || !valid || !items.length) return;
    review = { action: action, items: items.map(function (item) { return Object.assign({}, item); }), workspace: snapshot.workspace };
    var verb = action === 'archive' ? 'Archive' : action === 'restore' ? 'Restore' : 'Delete';
    $('review-title').textContent = verb + ' ' + items.length + (items.length === 1 ? ' chat?' : ' chats?');
    $('review-note').textContent = action === 'delete' ? 'Deletion cannot be undone. Export a copy first if you want to keep these conversations.' : action === 'restore' ? 'These conversations will return to your active history.' : 'These conversations will move to the archive. You can restore them later.';
    $('review-list').textContent = ''; items.forEach(function (item) { $('review-list').appendChild(element('li', item.title)); });
    $('confirm').textContent = verb + ' ' + items.length; $('confirm').className = action === 'delete' ? 'danger' : 'primary';
    $('review').hidden = false; controls(); $('cancel').focus();
  }
  async function run() {
    if (!review || busy) return;
    var plan = review, changed = [], failedId = null; review = null; $('review').hidden = true;
    busy = true; stop = false; $('stop').disabled = false; previewGeneration++; controls();
    $('batch').hidden = false; $('results').textContent = ''; $('progress').max = plan.items.length; $('progress').value = 0;
    var past = plan.action === 'delete' ? 'deleted' : plan.action === 'archive' ? 'archived' : 'restored';
    try {
      for (var i = 0; i < plan.items.length; i++) {
        if (stop) break;
        var item = plan.items[i]; failedId = item.id;
        $('progress-text').textContent = changed.length + ' of ' + plan.items.length + ' ' + past;
        status('Working on ' + item.title + '… Keep this tab open.');
        await api.change(root.fetch.bind(root), item, plan.action, plan.workspace, $('protect-pins').checked);
        changed.push(item.id); chosen.delete(item.id); $('progress').value = changed.length;
        $('results').appendChild(element('li', item.title + ' — ' + past));
        $('progress-text').textContent = changed.length + ' of ' + plan.items.length + ' ' + past;
        failedId = null;
        if (i + 1 < plan.items.length && !stop) await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      }
      status(changed.length + ' ' + past + '.' + (stop ? ' Stopped; remaining chats were not processed.' : ' Finished. Refresh ChatGPT later to synchronize its sidebar.'));
    } catch (error) {
      status(changed.length + ' ' + past + '. Stopped: ' + error.message, true);
      var failed = plan.items.find(function (item) { return item.id === failedId; });
      $('results').appendChild(element('li', (failed ? failed.title + ' — ' : '') + error.message));
    } finally {
      if (plan.action === 'archive' && changed.length) undo = changed.slice();
      if (plan.action === 'restore') undo = undo.filter(function (id) { return changed.indexOf(id) === -1; });
      busy = false; controls();
      var refreshed = await refresh(true);
      if (refreshed) {
        var unconfirmed = changed.filter(function (id) { var row = rows.find(function (r) { return r.id === id; }); return plan.action === 'delete' ? !!row : !row || row.archived !== (plan.action === 'archive'); });
        if (unconfirmed.length) status('ChatGPT acknowledged the changes, but ' + unconfirmed.length + ' could not be confirmed in the refreshed history. Check them before retrying.', true);
        plan.items.forEach(function (item) { if (changed.indexOf(item.id) === -1 && rows.some(function (r) { return r.id === item.id; })) chosen.add(item.id); });
        draw();
      }
      if (onChanged) onChanged();
    }
  }
  async function exportSelection() {
    if (busy || loading || !valid || !chosen.size) return;
    busy = true; stop = false; $('stop').disabled = false; controls();
    try {
      var data = await root.ChatSweeperExport.exportChats(root.fetch.bind(root), Array.from(chosen), snapshot.workspace, function (done, total) { status('Exporting ' + done + ' of ' + total + '…'); }, function () { return stop; });
      var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = element('a');
      a.href = url; a.download = 'ChatSweeper-library-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; ui.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000); status('Export download started. Attachments are referenced, not downloaded.');
    } catch (error) { status(error.message, true); }
    finally { busy = false; controls(); }
  }
  function close() {
    if (busy) return;
    generation++; previewGeneration++; loading = false; review = null; $('review').hidden = true;
    host.hidden = true; chosen.clear(); rows = []; snapshot = null; undo = []; valid = false; clearPreview(); $('rows').textContent = '';
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  root.ChatSweeperOrganizer = { open: function (options) {
    if (!host) create();
    if (!host.hidden && (loading || busy)) return;
    returnFocus = document.activeElement; onChanged = options && options.onChanged; host.hidden = false; theme();
    $('query').focus(); refresh();
  } };
})(window);

(function () {
  'use strict';
  if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)$/.test(location.origin)) return;
  if (document.getElementById('chatsweeper-root')) return;

  var enabled = false, busy = false, stopped = false, reviewing = false;
  var selected = new Map(), timer, savedFocus;
  var totals = null, counting = false, countGeneration = 0;
  var details = new Map(), workspace = null, operation = 'delete', loading = false;
  var exportedSelection = null;
  var host = document.createElement('div');
  host.id = 'chatsweeper-root';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483646;';
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>' +
    ':host{color-scheme:light;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17324d}' +
    '*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;cursor:pointer;border:1px solid #c9d6e2;border-radius:8px;padding:8px 12px;background:#fff;color:#17324d}button:hover{background:#edf4fa}button:disabled{opacity:.48;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #2778c4;outline-offset:3px}' +
    '#launcher{display:flex;align-items:center;gap:8px;box-shadow:0 3px 16px #17324d30;font-weight:600}svg{width:21px;height:21px}#panel{width:330px;max-width:calc(100vw - 32px);max-height:calc(100vh - 40px);overflow:auto;background:#fff;border:1px solid #c9d6e2;border-radius:14px;box-shadow:0 8px 32px #17324d30}#status[data-error="true"]{color:#8e1c2a;background:#fff0f1;border:1px solid #e8aeb7;border-radius:8px;padding:12px;font-weight:600}' +
    'header{display:flex;align-items:center;gap:9px;padding:16px;border-bottom:1px solid #e1e8ef}header strong{flex:1;font-size:17px}#close{border:0;font-size:22px;padding:0 7px}.body{padding:16px}p{margin:0 0 12px;color:#4b6278}#count{font-size:24px;font-weight:650;margin:0 0 8px;color:#17324d}.actions{display:flex;gap:8px;flex-wrap:wrap}.danger{background:#ac2636;color:#fff;border-color:#ac2636}.danger:hover{background:#8e1c2a}.primary{background:#175d98;color:#fff;border-color:#175d98}.primary:hover{background:#104b7d}#review{width:100%;margin-top:14px}#status{margin-top:12px;margin-bottom:0;font-size:13px}#confirmation{border-top:1px solid #e1e8ef;padding:16px;background:#f3f7fb}h2{font-size:17px;margin:0 0 8px}ul{padding-left:20px;max-height:160px;overflow:auto;margin:10px 0 16px;overflow-wrap:anywhere}#stop{margin-top:12px;width:100%}' +
    '</style><button id="launcher" title="Select chats to delete" aria-expanded="false"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAC6FBMVEX+/v76+vrd3d3w8PD+/f7////HxsdDQ0N+fn7//v709PSGhoYVFRWHh4fNzc1LS0suLi7h4eH4+PiTk5MfHx+Ojo7X19dUVFQ1NTXl5eX8/Pyfn58mJibi4uJdXV05OTnn5+f+/f329varq6srKyuUlJXDw8PBwcH9/f1fX15JSUnm5ubV1dU/Pz/S0tKtra1WVlX29fbs7Ox0dHR1dXX7+/v5+fnx8fFwcHBFRUUdHR0bGxtGRkbt7e24uLilpaXCwsJWVlZSUlInJycRERG1tLW/v7+vr6/e3t43NzdQUFBXVlZISEi2trbs6+y7urrW1tbr6+vR0dGFhIR7enpGRUYICAgLCwsxMTFsbGydnZ1/f3+bmprHx8fT09OMjIxxcXG9vb2ZmZk9PT0EBAQSEhIJCQn5+Pnj4+PU1NSQkJBqampiYmJra2uampoiIiIKCgo0NDQXFxf//v+ioqLg4ODJycmKioplZWVkZGRYWFdTU1OcnJx4d3chISEpKSn19fXq6urf39/u7u6ysbGOjY0oKChjY2NVVFUlJCQ4ODgODg7p6enc3NzGxsbk5OSnp6fHxsY8PDwYGBgkJCQjIyMeHh42NjYKCglEREQgICBhYWGFhYVbW1vr6uuenp6kpKSysrKwsLBCQUEFBQUcHBwMDAwwLzCPj4/f3t/Ly8u1tbXy8vKjo6NKSkotLS0NDQ0AAAABAQF7enswMDDQ0NCsrKyoqKjOzs46OjpOTk7Av8CpqKmYmJjo6OjFxcW6urrIyMjl5OXAwMBycnLZ2dmSkpKqqqra2trJyMizs7OLi4tubW2Xlpbe3d3My8tYWFhWVVZvbm9mZWWXl5dPT09zc3N2dnZZWVl5eXlfX19oZ2d2dXVYV1dmZmZCQkJ4eHhVVVXMzMxcW1xNTU2AgIC3traRkZF6enq8vLyNjY2BgIGHhoempqaurq63t7e0tLTX1teIh4e8u7yBgYGIiIj9/P349/hA8T4zAAAClklEQVQ4y2NgwAUYmZixS7BAKFY2dg5OBjyAi5uHlxWbTihg5eMXEGRF0wRSwgJVJyQsIoosDxNnYYGwWMXEJSTRbIACiFopaRlhVgYWhG4wgsmysLDKyskrsMLdpQjESkpIFjCwKquosqK4mlVNnZUBboOGuqaWNqoLdNh19Vhg9gnqG0jIGaL63cjYxIjB1AzkEE5zC0sraxtbVoSNICsEgaFiZy8F1MPq4Ohk4+ziysqC5AgpBUYNBlY3d6ACVg8LT10vbx9fZDew+vkzSAUEakixsjIEBYeEhoVHRBqxIkKAgdU2SohVJzomNs4tPiExKTklNc0pHRJ0YAWmQpJJDhm2mVnZOTm5eXq5+QWFRRG2xYhw1ynJKI0vMy+vqKyqjqypda6rsxGp12aQYoD5oqGxqVmvRbK1TUaev72js6ubnd0quae3TxEeh6z9EyYy6vBNmuwyZeq06TNUJGbOmt08Z+68YhZo3DCwMs1fsDBw0eKpS8KWpiybxr988QrWlXywJAIilVatblm1Zu06ifUbNm4q3LzFZCurhgY8mYAo5r5t2xfuCNzGv5NHYsEu492m0DQCcQIkkQUqmDNoKDHtEdsrvM8MSVpo/4GDq4HhxirFdehwGSMwMMG64UmeNerI0WP8x5tOnDx1+sxZu9gTJ0rFTtjq9ZbtYI47t+q8GYPphShWv4uXLl+pvHptb9f1Gzcr428Z375z1/FWxZF7949xMRRfe9DA97DG6drcXTcfHbaJfPzk6a5nV58fy30h8EK5GpgqWEu5pV++cp/z+s3p+LfvJgS9//AxfvuHT3lX8z5/cf/aCPKAlJCGhpSGFBB9+/4N5CwNUwYWBw4lVlMpUFjgyH1CXFLoUqh5Ew4AeHu4f9BdUPMAAAAASUVORK5CYII=" width="24" height="24" alt="">ChatSweeper</button>' +
    '<section id="panel" hidden aria-label="ChatSweeper"><header><strong>ChatSweeper</strong><button id="close" aria-label="Close ChatSweeper">×</button></header><div class="body"><p id="count">0 selected</p><p>Choose chats in the sidebar. Scroll the sidebar to load older chats.</p><div class="actions"><button id="all">Select loaded</button><button id="clear">Clear selection</button></div><button id="review" class="primary" disabled>Review deletion</button><button id="stop" hidden>Stop after current chat</button><p id="status" role="status" aria-live="polite">Open the sidebar to find chats.</p></div><section id="confirmation" hidden aria-label="Review selected chats"><h2>Delete these chats?</h2><p>This cannot be undone. Only the chats listed below will be deleted.</p><ul id="titles"></ul><div class="actions"><button id="cancel">Go back</button><button id="confirm" class="danger">Delete selected chats</button></div></section></section>';
  document.documentElement.appendChild(host);
  var $ = function (id) { return shadow.getElementById(id); };
  var libraryButton = document.createElement('button'); libraryButton.id = 'library'; libraryButton.textContent = 'Open full-history organizer';
  libraryButton.style.cssText = 'width:100%;margin:0 0 12px;background:#175d98;color:white';
  $('count').parentNode.insertBefore(libraryButton, $('count'));
  libraryButton.onclick = function () {
    if (busy || loading || reviewing) return;
    if (!window.ChatSweeperOrganizer) { status('Reload ChatSweeper and refresh this page to open the organizer.', true); return; }
    window.ChatSweeperOrganizer.open({ onChanged: function () { selected.clear(); refreshCount(); } });
  };
  var summary = document.createElement('section');
  summary.style.cssText = 'margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #e1e8ef';
  summary.innerHTML = '<strong id="total" style="font-size:19px" aria-live="polite">Total not counted yet</strong><p id="breakdown" style="font-size:12px;margin:4px 0 8px">Current workspace, including archived chats.</p><button id="refresh-count" style="font-size:12px;padding:4px 9px">Refresh count</button>';
  $('count').parentNode.insertBefore(summary, $('count'));
  var loaded = document.createElement('p'); loaded.id = 'loaded'; loaded.style.cssText = 'font-size:13px;margin:0 0 12px';
  $('count').parentNode.insertBefore(loaded, $('count').nextSibling);
  var filters = document.createElement('section'); filters.id = 'filters';
  filters.innerHTML = '<label for="search">Search loaded chat titles</label><input id="search" type="search" placeholder="e.g. recipes" autocomplete="off"><label for="age">Last updated</label><select id="age"><option value="0">Any time</option><option value="30">More than 30 days ago</option><option value="90">More than 90 days ago</option><option value="365">More than 1 year ago</option></select><label class="check"><input id="protect" type="checkbox" checked> Protect pinned chats</label><p id="matches" role="status"></p><button id="load-older">Load older chats</button>';
  loaded.parentNode.insertBefore(filters, loaded.nextSibling);
  var archiveButton = document.createElement('button'); archiveButton.id = 'archive'; archiveButton.textContent = 'Review archive';
  $('review').parentNode.insertBefore(archiveButton, $('review'));
  var exportButton = document.createElement('button'); exportButton.id = 'export'; exportButton.textContent = 'Export selected';
  $('review').parentNode.insertBefore(exportButton, $('review'));
  var backup = document.createElement('label'); backup.className = 'check'; backup.id = 'backup-label';
  backup.innerHTML = '<input id="backup" type="checkbox"> Export before deleting';
  $('review').parentNode.insertBefore(backup, $('review'));
  var progress = document.createElement('section'); progress.id = 'progress-section'; progress.hidden = true;
  progress.innerHTML = '<p id="progress-text" aria-live="polite"></p><progress id="progress" max="1" value="0" aria-label="Batch progress"></progress><ul id="results" aria-label="Batch results"></ul>';
  $('status').parentNode.insertBefore(progress, $('status'));
  var theme = document.createElement('label'); theme.className = 'theme';
  theme.innerHTML = 'Appearance <select id="theme"><option value="auto">Match ChatGPT</option><option value="light">Light</option><option value="dark">Dark</option></select>';
  $('panel').appendChild(theme);
  // Keep the main actions visible on laptop displays; review/results can scroll.
  summary.id = 'summary';
  summary.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:4px 8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--cs-border)';
  $('breakdown').style.cssText = 'grid-row:2;grid-column:1 / -1;font-size:12px;margin:0';
  $('refresh-count').style.cssText = 'grid-row:1;grid-column:2;font-size:11px;padding:3px 7px';
  $('total').style.fontSize = '17px';
  filters.nextElementSibling.hidden = true;
  theme.removeChild(theme.firstChild);
  $('theme').setAttribute('aria-label', 'Appearance');
  $('theme').options[0].textContent = 'Auto';
  $('panel').querySelector('header').insertBefore(theme, $('close'));
  var featureStyles = document.createElement('style');
  featureStyles.textContent = ':host{--cs-bg:#fff;--cs-soft:#f3f7fb;--cs-ink:#17324d;--cs-muted:#4b6278;--cs-border:#c9d6e2;--cs-danger:#ac2636;--cs-primary:#175d98;color:var(--cs-ink)}:host([data-theme="dark"]){color-scheme:dark;--cs-bg:#20252c;--cs-soft:#2c333d;--cs-ink:#edf3fa;--cs-muted:#b9c7d7;--cs-border:#4d5969;--cs-danger:#c84455;--cs-primary:#2677ba}#panel{width:360px;background:var(--cs-bg);border-color:var(--cs-border)}header{position:sticky;top:0;background:var(--cs-bg);z-index:2}header,#confirmation{border-color:var(--cs-border)}#launcher,button,input,select{color:var(--cs-ink);background:var(--cs-bg);border-color:var(--cs-border)}#launcher img{border-radius:4px}button:hover,#confirmation{background:var(--cs-soft)}p{color:var(--cs-muted)}#count{color:var(--cs-ink);font-size:21px}.primary{background:var(--cs-primary);color:white}.danger{background:var(--cs-danger);color:white}#filters{border-top:1px solid var(--cs-border);padding-top:10px;margin-bottom:12px}#filters>label:not(.check){display:block;margin:8px 0 4px}#search,#age{width:100%;font:inherit;border:1px solid var(--cs-border);border-radius:7px;padding:7px 9px}.check{display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px}.check input{width:16px;height:16px;flex-shrink:0}#matches{font-size:12px;margin:6px 0 8px}#load-older{font-size:12px}#archive,#export{margin:12px 6px 0 0;font-size:13px}#review{margin-top:4px}#progress-section{margin-top:12px;padding:10px;background:var(--cs-soft);border-radius:8px}#progress-text{margin:0 0 6px;font-weight:600}progress{width:100%;height:9px;accent-color:var(--cs-primary)}#results{font-size:12px;margin:6px 0 0;max-height:100px}.theme{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--cs-border);font-size:12px}.theme select{padding:4px;border:1px solid var(--cs-border);border-radius:5px}#status[data-error="true"]{background:var(--cs-soft);color:var(--cs-ink);border-color:var(--cs-danger)}';
  shadow.appendChild(featureStyles);
  var compactStyles = document.createElement('style');
  compactStyles.textContent = 'header{padding:12px 16px}.body{padding:12px 16px}#count{font-size:19px;margin-bottom:3px}#loaded{margin-bottom:8px!important;font-size:12px!important}#filters{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;padding-top:8px;margin-bottom:10px}#filters>label:not(.check){margin:0;font-size:12px}#filters>label[for="search"]{grid-row:1;grid-column:1}#filters>label[for="age"]{grid-row:1;grid-column:2}#search{grid-row:2;grid-column:1}#age{grid-row:2;grid-column:2}#search,#age{font-size:12px;padding:7px;min-width:0}#filters .check{grid-row:3;grid-column:1;font-size:12px;margin:5px 0}#load-older{grid-row:3;grid-column:2;align-self:center;padding:5px 7px}#matches{grid-row:4;grid-column:1 / -1;margin:0;font-size:11px}.actions button{font-size:12px;padding:7px 9px}#archive,#export{margin-top:9px;padding:7px 10px}#backup-label{margin:9px 0}#status{font-size:12px;margin-top:9px}.theme{padding:0;border:0}.theme select{max-width:75px;font-size:11px}#confirmation{padding:12px 16px}';
  shadow.appendChild(compactStyles);
  function syncTheme() {
    var choice = $('theme').value;
    var root = document.documentElement;
    var dark = root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark';
    var light = root.classList.contains('light') || root.getAttribute('data-theme') === 'light';
    if (!dark && !light) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    host.setAttribute('data-theme', choice === 'auto' ? (dark ? 'dark' : 'light') : choice);
  }
  $('theme').onchange = syncTheme;
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  var colorPreference = window.matchMedia('(prefers-color-scheme: dark)');
  if (colorPreference.addEventListener) colorPreference.addEventListener('change', syncTheme); else colorPreference.addListener(syncTheme);
  syncTheme();
  var style = document.createElement('style');
  style.textContent = '.chatsweeper-checkbox{appearance:auto!important;-webkit-appearance:checkbox!important;position:relative!important;display:inline-block!important;width:18px!important;height:18px!important;min-width:18px!important;margin:0 9px 0 2px!important;vertical-align:middle!important;cursor:pointer!important;accent-color:#175d98!important;z-index:2!important}.chatsweeper-selected{outline:2px solid #2778c4!important;outline-offset:-2px!important}';
  document.documentElement.appendChild(style);

  function idOf(a) {
    try {
      var url = new URL(a.getAttribute('href'), location.origin);
      if (url.origin !== location.origin) return null;
      var match = url.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)\/?$/);
      return match ? match[1] : null;
    } catch (_) { return null; }
  }
  function links() {
    return Array.from(document.querySelectorAll('nav a[href],aside a[href],[data-testid="history"] a[href],#history a[href]')).filter(function (a) {
      return idOf(a) && !a.closest('main') && a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden';
    });
  }
  function titleOf(a) { return (a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent || 'Untitled chat').trim(); }
  function timestamp(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    return Date.parse(value);
  }
  function eligibility(a) {
    var meta = details.get(idOf(a));
    if ($('search').value.trim() && titleOf(a).toLocaleLowerCase().indexOf($('search').value.trim().toLocaleLowerCase()) === -1) return 'Title does not match';
    if ($('protect').checked && (!meta || meta.pinned)) return meta ? 'Pinned chat protected' : 'Refresh count to check pinned status';
    var days = Number($('age').value);
    if (days) {
      var updated = timestamp(meta && meta.updated);
      if (!Number.isFinite(updated)) return 'Last-updated date unavailable';
      if (updated >= Date.now() - days * 86400000) return 'Newer than the selected age';
    }
    return '';
  }
  function eligibleLinks() { return links().filter(function (a) { return !eligibility(a); }); }
  function changeFilters() {
    selected.clear(); exportedSelection = null;
    update(); status('Filters changed; selection cleared. Select matching loaded chats.');
  }
  $('search').oninput = changeFilters; $('age').onchange = changeFilters; $('protect').onchange = changeFilters;
  function status(message, error) {
    $('status').setAttribute('data-error', String(!!error));
    $('status').setAttribute('role', error ? 'alert' : 'status');
    $('status').textContent = message;
  }
  function update() {
    $('library').disabled = busy || loading || reviewing;
    $('count').textContent = selected.size + ' selected';
    $('loaded').textContent = new Set(links().map(idOf)).size + ' loaded in sidebar';
    $('matches').textContent = new Set(eligibleLinks().map(idOf)).size + ' matching, unprotected chats loaded.' + ($('protect').checked && !details.size ? ' Waiting for chat details; refresh count if unavailable.' : '');
    $('all').textContent = 'Select matching loaded';
    $('refresh-count').disabled = counting || busy || reviewing || loading;
    ['review', 'archive', 'export'].forEach(function (id) { $(id).disabled = !selected.size || busy || reviewing || loading || counting; });
    ['all', 'clear', 'search', 'age', 'protect', 'load-older', 'backup'].forEach(function (id) { $(id).disabled = busy || reviewing || loading; });
    $('all').disabled = $('all').disabled || (counting && $('protect').checked);
    $('close').disabled = busy;
    $('stop').hidden = !busy;
    document.querySelectorAll('.chatsweeper-checkbox').forEach(function (box) {
      var a = box.closest('a');
      box.checked = selected.has(idOf(a));
      var reason = eligibility(a);
      box.disabled = busy || reviewing || loading || !!reason;
      box.title = reason || 'Select ' + titleOf(a);
      a.classList.toggle('chatsweeper-selected', box.checked);
    });
  }
  function renderTotals() {
    if (!totals) return;
    $('total').textContent = (totals.active.size + totals.archived.size).toLocaleString() + ' total chats';
    $('breakdown').textContent = totals.active.size.toLocaleString() + ' active · ' + totals.archived.size.toLocaleString() + ' archived · Current workspace';
  }
  async function refreshCount() {
    if (counting || busy || loading) return;
    var generation = ++countGeneration;
    counting = true; totals = null;
    $('total').textContent = 'Counting chats…';
    $('breakdown').textContent = 'Checking all pages, including pinned and archived chats.';
    update();
    try {
      if (!window.ChatSweeperCounts) throw new Error('Reload the extension and refresh ChatGPT to enable counting.');
      var result = await window.ChatSweeperCounts.countChats(window.fetch.bind(window), function (n) {
        if (generation === countGeneration) $('total').textContent = 'Counting… ' + n.toLocaleString() + ' found';
      }, function () { return generation !== countGeneration; });
      if (generation !== countGeneration) return;
      if (workspace && workspace !== result.workspace) { selected.clear(); exportedSelection = null; }
      totals = result; details = result.details; workspace = result.workspace; renderTotals();
      links().forEach(function (a) { if (eligibility(a)) selected.delete(idOf(a)); });
    } catch (error) {
      if (generation !== countGeneration) return;
      $('total').textContent = 'Total unavailable';
      $('breakdown').textContent = error.message;
    } finally {
      if (generation === countGeneration) { counting = false; update(); }
    }
  }
  $('refresh-count').onclick = refreshCount;
  function scan() {
    if (!enabled) return;
    links().forEach(function (a) {
      var id = idOf(a), box = a.querySelector('.chatsweeper-checkbox');
      if (!box) {
        box = document.createElement('input');
        box.type = 'checkbox'; box.className = 'chatsweeper-checkbox';
        box.addEventListener('click', function (event) { event.stopPropagation(); });
        box.addEventListener('change', function () {
          var current = idOf(a); exportedSelection = null;
          if (eligibility(a)) { box.checked = false; return; }
          if (box.checked) selected.set(current, titleOf(a)); else selected.delete(current);
          update();
        });
        a.insertBefore(box, a.firstChild);
      }
      box.setAttribute('aria-label', 'Select ' + titleOf(a));
    });
    update();
  }
  function toggle() {
    if (busy || loading) return;
    enabled = !enabled;
    $('launcher').hidden = enabled; $('panel').hidden = !enabled;
    $('launcher').setAttribute('aria-expanded', String(enabled));
    if (enabled) {
      savedFocus = document.activeElement;
      scan(); status('Select loaded includes only chats currently loaded in the sidebar.');
      refreshCount();
      $('close').focus();
    } else {
      selected.clear(); reviewing = false; $('confirmation').hidden = true;
      document.querySelectorAll('.chatsweeper-checkbox').forEach(function (box) { box.remove(); });
      document.querySelectorAll('.chatsweeper-selected').forEach(function (a) { a.classList.remove('chatsweeper-selected'); });
      if (savedFocus && savedFocus.isConnected) savedFocus.focus();
    }
  }
  $('launcher').onclick = toggle; $('close').onclick = toggle;
  $('all').onclick = function () { exportedSelection = null; eligibleLinks().forEach(function (a) { selected.set(idOf(a), titleOf(a)); }); update(); };
  $('clear').onclick = function () { exportedSelection = null; selected.clear(); update(); };
  function showReview(action) {
    if (!selected.size || busy) return;
    operation = action;
    reviewing = true; $('titles').textContent = '';
    selected.forEach(function (title) { var li = document.createElement('li'); li.textContent = title; $('titles').appendChild(li); });
    $('confirmation').querySelector('h2').textContent = action === 'archive' ? 'Archive these chats?' : 'Delete these chats?';
    $('confirmation').querySelector('p').textContent = action === 'archive' ? 'These chats will leave the sidebar. You can restore them from ChatGPT’s archived chats settings.' : 'This cannot be undone. Only the chats listed below will be deleted.';
    $('confirm').className = action === 'archive' ? 'primary' : 'danger';
    $('confirm').textContent = (action === 'archive' ? 'Archive ' : 'Delete ') + selected.size + (selected.size === 1 ? ' chat' : ' chats');
    $('confirmation').hidden = false; update(); $('cancel').focus();
  }
  $('review').onclick = function () { showReview('delete'); };
  $('archive').onclick = function () { showReview('archive'); };
  $('cancel').onclick = function () { reviewing = false; $('confirmation').hidden = true; update(); $('review').focus(); };
  $('stop').onclick = function () { stopped = true; $('stop').disabled = true; status('Stopping after the current chat finishes…'); };
  function scrollContainer() {
    var first = links()[0];
    for (var el = first; el && el !== document.body; el = el.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }
  $('load-older').onclick = async function () {
    if (busy || reviewing || loading) return;
    var container = scrollContainer();
    if (!container) { status('Open the sidebar and expand its chat history. No scrollable chat list was found.', true); return; }
    loading = true; update(); status('Loading older chats…');
    var before = new Set(links().map(idOf));
    try {
      container.scrollTop = container.scrollHeight;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      var added = 0;
      for (var attempt = 0; attempt < 30; attempt++) {
        await pause(200);
        added = new Set(links().map(idOf).filter(function (id) { return !before.has(id); })).size;
        if (added) break;
      }
      scan();
      status(added ? added + ' older chats loaded. Your filters apply to them too.' : 'No additional chats appeared. You may be at the end; try again if ChatGPT is still loading.');
    } finally { loading = false; update(); }
    // Refresh metadata so newly loaded rows can be checked for age and pins.
    if (links().some(function (a) { return !details.has(idOf(a)); })) refreshCount();
  };
  function selectionKey() { return JSON.stringify(Array.from(selected.keys()).sort()); }
  function beginProgress(total, text) {
    $('progress-section').hidden = false; $('progress').max = Math.max(1, total); $('progress').value = 0;
    $('progress-text').textContent = text; $('results').textContent = '';
  }
  function reportResult(text) {
    var li = document.createElement('li'); li.textContent = text; $('results').appendChild(li);
  }
  async function downloadSelection() {
    if (!window.ChatSweeperExport) throw new Error('Reload the extension and refresh ChatGPT to enable export.');
    var ids = Array.from(selected.keys());
    beginProgress(ids.length, 'Preparing export…');
    var data = await window.ChatSweeperExport.exportChats(window.fetch.bind(window), ids, workspace, function (done, total) {
      $('progress').value = done; $('progress-text').textContent = 'Exported ' + done + ' of ' + total;
    }, function () { return stopped; });
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'ChatSweeper-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    shadow.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    exportedSelection = selectionKey();
    status('Export download started. Check your Downloads folder. Attachments are referenced, not downloaded.');
  }
  $('export').onclick = async function () {
    if (busy || reviewing || !selected.size) return;
    busy = true; stopped = false; $('stop').disabled = false; update();
    try { await downloadSelection(); }
    catch (error) { status(error.message, true); reportResult(error.message); }
    finally { busy = false; update(); }
  };
  shadow.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !busy) { if (reviewing) $('cancel').click(); else toggle(); }
  });

  function visible(el) { return el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'; }
  function dialogs() { return Array.from(document.querySelectorAll('[role="dialog"]:not([aria-modal="false"]),[role="alertdialog"],dialog[open]')).filter(visible); }
  function waitFor(check, message) {
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      function poll() {
        try { var result = check(); if (result) return resolve(result); }
        catch (error) { return reject(error); }
        if (Date.now() - started > 8000) return reject(new Error(message));
        setTimeout(poll, 100);
      }
      poll();
    });
  }
  function pause(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function menuFor(a) {
    var row = a;
    for (var depth = 0; row && depth < 12; depth++, row = row.parentElement) {
      if (row.matches('nav,aside,body,main,[data-testid="history"],#history')) break;
      var ids = new Set(Array.from(row.querySelectorAll('a[href]')).map(idOf).filter(Boolean));
      if (ids.size > 1) break;
      var candidates = Array.from(row.querySelectorAll('button,[role="button"]')).filter(function (b) {
        return b.getAttribute('aria-haspopup') === 'menu' || /(?:options|more|conversation.*menu)/i.test(b.getAttribute('aria-label') || '') || /history-item.*options/.test(b.getAttribute('data-testid') || '');
      });
      if (candidates.length === 1) return candidates[0];
    }
    return null;
  }
  async function openChatAction(id, action) {
    if (dialogs().length || document.querySelector('[role="menu"][data-state="open"]')) throw new Error('Close other menus or dialogs, then try again.');
    var a = links().find(function (link) { return idOf(link) === id; });
    if (!a) throw new Error('A selected chat is no longer loaded. Scroll it into view, or clear the selection and select again.');
    a.scrollIntoView({ block: 'nearest' });
    a.focus();
    a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    var menu = await waitFor(function () { return menuFor(a); }, 'Could not find this chat’s options button. No further chats were deleted.');
    // Radix menus open on pointerdown; avoid a second click toggling them shut.
    menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, buttons: 1 }));
    menu.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }));
    await pause(150);
    if (!Array.from(document.querySelectorAll('[role="menuitem"]')).some(visible)) menu.click();
    var pattern = action === 'archive' ? /^(archive|archive chat)$/i : /^(delete|delete chat)$/i;
    return await waitFor(function () {
      var items = Array.from(document.querySelectorAll('[role="menuitem"]')).filter(visible);
      if ($('protect').checked && items.some(function (el) { return /^(unpin|unpin chat)$/i.test(el.textContent.trim()); })) throw new Error('This chat is now pinned. Pinned-chat protection stopped the queue. Close its menu before retrying.');
      return items.find(function (el) { return pattern.test(el.textContent.trim()); });
    }, 'Could not find ' + action + ' in the chat menu. Use ChatGPT’s English interface and try again.');
  }
  async function deleteChat(id, title) {
    var remove = await openChatAction(id, 'delete');
    remove.click();
    var dialog = await waitFor(function () {
      return dialogs().find(function (el) { return /delete/i.test(el.textContent); });
    }, 'ChatGPT did not show its delete confirmation. The queue has stopped.');
    var text = dialog.textContent.replace(/\s+/g, ' ');
    if (!title || text.indexOf(title.replace(/\s+/g, ' ')) === -1) throw new Error('Could not verify the chat title in ChatGPT’s confirmation. Review the open dialog manually.');
    var confirm = Array.from(dialog.querySelectorAll('button')).filter(function (el) { return visible(el) && /^(delete|delete chat)$/i.test(el.textContent.trim()); });
    if (confirm.length !== 1 || confirm[0].disabled) throw new Error('ChatGPT’s delete confirmation changed. The queue has stopped.');
    confirm[0].click();
    await waitFor(function () {
      return !dialogs().length && !links().some(function (el) { return idOf(el) === id; });
    }, 'Deletion was not confirmed by the sidebar. Check ChatGPT before retrying.');
    await pause(900);
    if (links().some(function (el) { return idOf(el) === id; })) throw new Error('The chat reappeared. ChatGPT may have rejected deletion. Check your connection.');
  }
  async function archiveChat(id, title) {
    var archive = await openChatAction(id, 'archive');
    archive.click();
    var confirmed = false;
    await waitFor(function () {
      var dialog = dialogs().find(function (el) { return /archive/i.test(el.textContent); });
      if (dialog && !confirmed) {
        if (dialog.textContent.replace(/\s+/g, ' ').indexOf(title.replace(/\s+/g, ' ')) === -1) throw new Error('Could not verify the chat title in the archive confirmation.');
        var buttons = Array.from(dialog.querySelectorAll('button')).filter(function (b) { return visible(b) && !b.disabled && /^(archive|archive chat)$/i.test(b.textContent.trim()); });
        if (buttons.length !== 1) throw new Error('ChatGPT’s archive confirmation changed.');
        confirmed = true; buttons[0].click();
      }
      return !dialogs().length && !links().some(function (el) { return idOf(el) === id; });
    }, 'Archiving was not confirmed by the sidebar. Check ChatGPT before retrying.');
    await pause(900);
    if (links().some(function (el) { return idOf(el) === id; })) throw new Error('The chat reappeared. ChatGPT may have rejected archiving.');
  }
  $('confirm').onclick = async function () {
    if (busy || !reviewing || !selected.size) return;
    if (operation === 'delete' && $('backup').checked && exportedSelection !== selectionKey()) {
      busy = true; stopped = false; $('stop').disabled = false; update();
      $('confirm').disabled = true; $('cancel').disabled = true;
      try {
        await downloadSelection();
        $('confirmation').querySelector('p').textContent = 'Check that the JSON export is saved in Downloads, then click Delete again. Deletion cannot be undone.';
      } catch (error) { status(error.message, true); reportResult(error.message); }
      finally { busy = false; $('confirm').disabled = false; $('cancel').disabled = false; update(); }
      return;
    }
    var queue = Array.from(selected.entries()), done = 0;
    var past = operation === 'archive' ? 'archived' : 'deleted';
    var doing = operation === 'archive' ? 'Archiving' : 'Deleting';
    busy = true; stopped = false; reviewing = false;
    if (counting) {
      countGeneration++; counting = false;
      $('total').textContent = 'Count paused';
      $('breakdown').textContent = 'The total will refresh after deletion finishes.';
    }
    $('confirmation').hidden = true; $('stop').disabled = false; update();
    beginProgress(queue.length, '0 of ' + queue.length + ' ' + past);
    try {
      for (var i = 0; i < queue.length; i++) {
        if (stopped) break;
        var meta = details.get(queue[i][0]);
        if ($('protect').checked && (!meta || meta.pinned)) throw new Error('This chat is pinned or its pinned status is unknown. Refresh the count and review your selection.');
        status(doing + ' ' + (i + 1) + ' of ' + queue.length + '… Keep this tab open.');
        if (operation === 'archive') await archiveChat(queue[i][0], queue[i][1]); else await deleteChat(queue[i][0], queue[i][1]);
        selected.delete(queue[i][0]); done++;
        if (totals) {
          totals.active.delete(queue[i][0]);
          if (operation === 'archive') totals.archived.add(queue[i][0]); else totals.archived.delete(queue[i][0]);
          renderTotals();
        }
        $('progress').value = done; $('progress-text').textContent = done + ' of ' + queue.length + ' ' + past;
        reportResult(queue[i][1] + ' — ' + past);
        update();
      }
      status(done + ' ' + past + '.' + (stopped ? ' Stopped; remaining chats stay selected.' : ' Finished.'));
      if (stopped) reportResult('Stopped. ' + (queue.length - done) + ' chats were not processed.');
    } catch (error) {
      status(done + ' ' + past + '. Stopped: ' + error.message, true);
      reportResult((queue[done] ? queue[done][1] + ' — ' : '') + 'Failed: ' + error.message);
      reportResult((queue.length - done - 1) + ' later chats were not attempted.');
    } finally { busy = false; update(); refreshCount(); }
  };
  // Prevent navigation or competing manual menu actions during a queue.
  ['pointerdown', 'click', 'keydown'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (busy && event.isTrusted && event.composedPath().indexOf(host) === -1) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  });
  window.addEventListener('beforeunload', function (event) { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  new MutationObserver(function (mutations) {
    if (!enabled || mutations.every(function (m) { return m.target === host || host.contains(m.target); })) return;
    clearTimeout(timer); timer = setTimeout(scan, 120);
  }).observe(document.body, { childList: true, subtree: true });
  var extensionApi = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;
  if (extensionApi && extensionApi.runtime && extensionApi.runtime.onMessage) {
    extensionApi.runtime.onMessage.addListener(function (message, sender, respond) {
      if (message.type === 'chatsweeper-toggle') { toggle(); respond({ enabled: enabled }); }
    });
  }
})();
