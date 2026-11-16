# ChatSweeper

Version **0.4.1** — includes the full-history organizer, archive restoration and undo, and conversation previews.

Find, select, export, archive, and delete ChatGPT conversations. No external servers, analytics, or dependencies are used at runtime. Counting, previews, organizer actions, and exporting use your existing ChatGPT session token in memory only; it is never saved or sent outside ChatGPT.

## Organize chats

- **Search loaded chat titles** filters titles without case sensitivity. It combines with **Last updated** filters for 30 days, 90 days, or one year. Age means time since the last update, not creation. Chats without a known update date are excluded from age-based selections.
- **Protect pinned chats** is on by default. Pinned/starred chats and chats whose pinned status has not loaded cannot be selected until you turn protection off. Refresh count to fetch current details. Protection is checked again when a batch runs.
- **Select matching loaded** selects only eligible chats currently rendered in the sidebar. Filters disable nonmatching checkboxes; they do not hide your original ChatGPT history. Changing filters clears the selection so previously selected, now-nonmatching chats cannot slip into a batch.
- **Load older chats** scrolls the chat history to request another batch. Repeat it to load more. ChatGPT controls how much history it renders; a no-new-chats message does not prove that the account has no more history. Open the sidebar first.
- **Review archive** shows selected titles before archiving. Archived chats leave the sidebar but remain in the total. Restore them through ChatGPT's archived-chat settings. The full-history organizer can also restore archived chats.
- **Export selected** downloads one JSON file containing the selected conversations' message trees, titles, and dates. It includes branches returned by ChatGPT. Images and attachments are referenced, not downloaded; it is not a full account export or a ChatGPT import file.
- **Export before deleting** downloads the selected chats before deletion. You must check that the file is saved and click Delete again. Any export failure blocks the batch. Download delivery is handled by the browser; the extension cannot confirm that you kept the file.
- **Batch progress** shows completed/total, results by title, and failures. A failure stops the queue; later chats are not attempted. Remaining selections are preserved for review. Stop finishes the in-flight operation; it cannot undo completed work.
- **Appearance** follows ChatGPT's light/dark theme (or system theme when ChatGPT has no explicit theme). You can choose Light or Dark for the current page session.

In the compact panel, search, age filters, and bulk actions apply to loaded sidebar chats. The total count covers the whole current workspace, including archived chats. Those scopes are deliberately shown separately.

## Full-history organizer (0.4.1)

Click **Open full-history organizer** to search all titles in the current workspace, filter active/archived chats and age, and sort by title, creation date, or last update. **Select all matches** spans every result page. Changing filters or sort clears selection.

Click a title to preview up to eight recent visible messages from the current branch. Previews are plain-text excerpts; attachments are not downloaded.

Choose **Archived** to restore selected chats. **Undo last archive** reviews restoration of the latest successful archive batch during the current open organizer session. Closing clears undo history; archived chats remain restorable through the Archived filter. Deletion is permanent.

Organizer actions use authenticated ChatGPT requests, verify workspace and current chat state, require review, and stop on failure. Export selected before deleting if you want a local copy. The compact panel also has a separate export-before-delete workflow. Conversation contents used for previews and action verification stay in memory; no developer server receives them. Internal ChatGPT APIs can change.

## Chat count

Opening ChatSweeper counts the chats in the current workspace, including pinned and archived chats. It displays the total, active/archived breakdown, and a separate count of chats currently loaded in the sidebar. Use **Refresh count** after changes in other tabs; the count refreshes automatically after a deletion batch.

ChatGPT sometimes reports a pagination estimate as its `total`. ChatSweeper instead walks the conversation lists to their end and counts unique IDs across categories. Large accounts may take longer. Counting only reads list metadata; it does not open conversation contents. If a request fails, the panel shows **Total unavailable** rather than a misleading zero. Lists changing in another tab during counting can affect the snapshot; refresh once changes are finished.

Counting uses ChatGPT's internal, undocumented conversation-list endpoint and may need updating if that interface changes. It counts the current workspace, not all workspaces combined, and does not include deleted or unsaved temporary chats.

## Install on Chrome

1. Download this repository using **Code → Download ZIP** and extract it (or clone it), then open `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select `dist/chrome` (or the `chrome` folder in the Mac test package).
4. Reload your ChatGPT tab. Pin ChatSweeper using Chrome's extensions menu if you want the toolbar icon.
5. Open ChatGPT's sidebar and click the ChatSweeper toolbar icon or the broom button at the bottom right of the page.

Use ChatGPT's **English** interface. Wait for chat details to load, select individual chats or choose **Select matching loaded**, then **Review deletion** or **Review archive**. Review the titles and confirm. Deletion cannot be undone. Start with a disposable conversation to test your ChatGPT layout.

Keep the tab open during deletion. **Stop after current chat** stops the remaining queue; it cannot undo a deletion already sent. Normal page interactions are temporarily blocked while the queue runs so they cannot interfere with ChatGPT's menus.

## Browser builds

- `dist/firefox`: Manifest V3 with a Firefox background event page; targets desktop Firefox 142 and newer. See [Firefox setup and testing](firefox/README.md).
- `dist/chrome`: Manifest V3, targets Chrome 88 and newer. This is the build for the Mac's Chrome 150.
- `dist/chrome-legacy`: Manifest V2, targets Chrome 61–87 and Chromium browsers that still support Manifest V2. Browser compatibility targets are not a promise that today's ChatGPT will run on an old browser.
- `dist/min/chatsweeper.user.js`: Min userscript. In Min Preferences, enable **User Scripts**, click **Show script directory**, and copy the script there. Reload ChatGPT and use the on-page ChatSweeper button. On macOS the default script directory is `~/Library/Application Support/Min/userscripts`.

Do not install multiple variants in the same browser. Chrome's current versions require the Manifest V3 build. Min uses its own userscript support instead of Chrome's extension installation flow.

## Install temporarily in Firefox

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and choose `dist/firefox/manifest.json`. Refresh ChatGPT and allow site access if Firefox requests it. Use the ChatSweeper toolbar icon or on-page button. Temporary add-ons last until Firefox restarts; a permanent release requires Mozilla signing.

Run `npm run package:firefox` to build, validate with Mozilla's `web-ext`, and create the unsigned testing ZIP under `firefox/submission/`. Run `npx playwright install firefox` once, then `npm run test:firefox` for the Firefox test suite. Both Firefox and Chromium passed all 34 automated tests for this port. The Firefox package validator reports zero errors, notices, or warnings.

## Scope and safeguards

- Checkboxes appear only on conversation links inside the sidebar/history navigation, not links within messages.
- **Select matching loaded** means the matching, unprotected chats currently rendered in the sidebar, including those below its scroll viewport. It does not mean your entire account. Load older chats, then select again.
- Selection is in memory for this tab only. Closing ChatSweeper or refreshing clears it.
- In the compact panel, chats are deleted or archived sequentially using ChatGPT’s own options menu. The chat title must match any confirmation dialog before its final button is clicked. Some ChatGPT layouts archive immediately when Archive is chosen; ChatSweeper always shows its own review first.
- A missing chat, unexpected menu, mismatched title, or unconfirmed removal stops the queue and keeps remaining selections. If ChatGPT leaves a dialog open, review or cancel it manually before retrying.
- In the compact panel, a successful result means ChatGPT’s confirmation closed and the chat disappeared from the sidebar. This is not an independent server-side verification; refresh afterward to check the result.
- This adapter supports English Delete/Archive labels. ChatGPT can change its markup, so compatibility needs testing against your signed-in interface. Those sidebar restrictions do not apply to the full-history organizer.

## Development

Node.js 22 is used for building and testing (the extension itself needs no Node.js).

```sh
npm ci
npm run build
npm test
```

Tests use Playwright with `/usr/bin/chromium-browser`. Set `CHROME_PATH` for another Chromium executable. Tests cover pagination totals, sidebar selection, dynamic rows, cancellation, title verification, click/pointer menus, deletion and archive failures, stopping a batch, filters, pin protection, loading history, export downloads and safeguards, and both themes. They do not modify real ChatGPT conversations.

Source: `extension/`. Generated, ready-to-load builds: `dist/`. Run the build after source changes and click Reload in Chrome's extensions page, then reload ChatGPT.

## Chrome Web Store package

Run `npm run package:store` to build the extension, capture store-sized images on a labelled sample-data page, smoke-test the actual packaged extension, and create a strict-allowlist upload ZIP. It requires Chromium and Python 3 in addition to the development dependencies above.

The upload file is `store/submission/ChatSweeper-0.4.1-chrome-store.zip`. Its manifest is at the ZIP root. The older multi-browser ZIPs are installation bundles, not Chrome Web Store upload packages. `store/START-HERE.txt` explains the submission kit, listing copy, privacy draft, and reviewer notes.

This package is ready for a **draft upload**, not the proposed paid launch. The current build is unrestricted: the five-action allowance, $1.99/month checkout, licensing backend, and Pro gating are not implemented. A public privacy-policy URL and publisher support details are also still needed. Do not advertise the planned subscription until the paid build and disclosures are complete.

Credentials, local connection files, backups, dependencies, test artifacts, and generated ZIP archives are excluded from version control. Run the packaging command to generate upload ZIPs locally.

The 0.4.1 release passed 34 automated tests, including full-history pagination, restoration, undo, previews, workspace changes, and stopping batches.

ChatSweeper is an independent product, not affiliated with or endorsed by OpenAI. ChatGPT is a trademark of OpenAI.

Compatibility references: [Chrome manifest migration](https://developer.chrome.com/docs/extensions/develop/migrate/manifest), [Manifest V2 retirement](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline), [Min userscripts](https://github.com/minbrowser/min/wiki/userscripts).
