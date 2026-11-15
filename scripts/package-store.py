"""Create a strict-allowlist Chrome Web Store ZIP with a root manifest."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'dist/chrome'
manifest = json.loads((source / 'manifest.json').read_text())
assert manifest['manifest_version'] == 3
assert len(manifest['description']) <= 132
allowed_hosts = {'https://chatgpt.com/*', 'https://chat.openai.com/*'}
assert set(manifest['content_scripts'][0]['matches']) == allowed_hosts
assert not manifest.get('permissions') and not manifest.get('host_permissions')
files = ['manifest.json', 'background.js', 'counts.js', 'export.js', 'history-api.js', 'organizer.js', 'content.js']
files += ['icons/' + str(size) + '.png' for size in [16, 32, 48, 128]]
references = [manifest['background']['service_worker']]
references += manifest['content_scripts'][0]['js'] + list(manifest['icons'].values())
assert all(name in files for name in references)
out = root / 'store/submission'
out.mkdir(parents=True, exist_ok=True)
destination = out / ('ChatSweeper-' + manifest['version'] + '-chrome-store.zip')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        path = source / name
        assert path.is_file() and not path.is_symlink()
        archive.write(path, name)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(files)
    assert json.loads(archive.read('manifest.json')) == manifest
digest = hashlib.sha256(destination.read_bytes()).hexdigest()
(out / 'SHA256SUMS.txt').write_text(digest + '  ' + destination.name + '\n')
(out / 'PACKAGE-CONTENTS.txt').write_text('\n'.join(files) + '\n')
print('Validated:', destination, '(' + str(destination.stat().st_size) + ' bytes)')
print('Status: uploadable draft. Paid launch still requires billing/quota implementation and a public privacy policy.')
