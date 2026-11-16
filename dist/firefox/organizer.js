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
