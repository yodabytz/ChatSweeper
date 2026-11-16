"""Package only runtime files for Firefox temporary installation or AMO submission."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'dist/firefox'
manifest = json.loads((source / 'manifest.json').read_text())
assert manifest['manifest_version'] == 3
assert manifest['background'] == {'scripts': ['background.js']}
assert 'minimum_chrome_version' not in manifest
assert manifest['browser_specific_settings']['gecko']['id'] == 'chatsweeper@yodabytz.github.io'
assert set(manifest['content_scripts'][0]['matches']) == {'https://chatgpt.com/*', 'https://chat.openai.com/*'}
assert not manifest.get('permissions') and not manifest.get('host_permissions')
files = ['manifest.json', 'background.js', 'counts.js', 'export.js', 'history-api.js', 'organizer.js', 'content.js']
files += ['icons/' + str(size) + '.png' for size in [16, 32, 48, 128]]
assert all(f in files for f in manifest['content_scripts'][0]['js'])
out = root / 'firefox/submission'
out.mkdir(parents=True, exist_ok=True)
destination = out / ('ChatSweeper-' + manifest['version'] + '-firefox.zip')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        assert (source / name).is_file() and not (source / name).is_symlink()
        archive.write(source / name, name)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None and set(archive.namelist()) == set(files)
digest = hashlib.sha256(destination.read_bytes()).hexdigest()
(out / 'SHA256SUMS.txt').write_text(digest + '  ' + destination.name + '\n')
print('Validated unsigned Firefox package:', destination)
print('Load temporarily through about:debugging. Permanent installation requires Mozilla signing.')
