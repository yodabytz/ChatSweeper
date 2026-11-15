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
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, respond) {
      if (message.type === 'chatsweeper-toggle') { toggle(); respond({ enabled: enabled }); }
    });
  }
})();
