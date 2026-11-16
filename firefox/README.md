# ChatSweeper for Firefox

This desktop Firefox port includes the same organizer, counts, previews, export,
archive/restore, and deletion features as the Chrome build. It targets Firefox
142 and newer. Android has not been tested.

## Test in your Firefox browser

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `dist/firefox/manifest.json` from this repository, or the generated
   `ChatSweeper-0.4.1-firefox.zip` package.
4. Open or refresh ChatGPT. If Firefox asks, allow ChatSweeper to run on ChatGPT.
5. Click the on-page ChatSweeper button or its toolbar icon.

On the Mac test installation, choose
`Desktop/ChatSweeper/firefox/manifest.json` in step 3.

Temporary add-ons are removed when Firefox restarts. Reload the add-on from
the same debugging page after updating its files, then refresh ChatGPT.
Permanent installation requires Mozilla signing; this unsigned development
package is not a published Firefox Add-ons listing.

Try previews and counting first, then use disposable conversations to test
archive, restore, and deletion. Deletion is permanent.

## Build and validate

```sh
npm ci
npx playwright install firefox
npm run test:firefox
npm run package:firefox
```

The package is written to `firefox/submission/`. Packaging uses a runtime-file
allowlist and Mozilla's `web-ext` validator. Source and ready-to-load files are
included in Git; generated ZIPs are excluded.

Both Firefox and Chromium pass 34 automated tests. A separate installed-add-on
smoke test passed on macOS with Firefox 155.0.1, using sample conversations:

```sh
python3 scripts/firefox-smoke.py /path/to/firefox dist/firefox
```

This test launches a disposable headless profile, installs the production
manifest, then tests an isolated copy against a local fixture server. Only that
copy's site match and origin guard change. It verifies content-script injection,
authenticated requests, counting, previews, archive review, and undo/restore.
It does not use your signed-in profile or change real conversations.

Firefox uses an event-page background script and Promise-based messaging.
The Chrome build continues to use its service worker and callback messaging.
Neither build requires broad browsing-history or all-sites permissions.

## Data permissions

The Firefox manifest declares authentication information, account identifiers,
and website activity because authenticated requests send the current session,
workspace identifier, and reviewed chat actions to ChatGPT. There is no
developer-operated collection server or analytics. Message previews and exports
are processed locally; exports are saved only when requested. These declarations
do not enable billing or send conversation contents to a new service.

Before a public release, complete publisher/support details and publish the
privacy policy. The five-action free tier and subscription remain unimplemented.

References: [Firefox background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background),
[Mozilla data declarations](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
