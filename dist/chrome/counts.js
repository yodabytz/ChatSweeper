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
