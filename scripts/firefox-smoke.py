"""Exercise an installed Firefox add-on in a disposable profile with local fixture data.

Usage: python3 scripts/firefox-smoke.py FIREFOX_BINARY dist/firefox
The production manifest is installed first. A temporary copy then changes the
content-script match and origin guard to the loopback fixture server. No real
account is used; production files are not modified.
"""
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse, parse_qs


class Protocol:
    def __init__(self, connection):
        self.connection = connection
        self.counter = 0
        self.receive()

    def receive(self):
        size = b''
        while True:
            byte = self.connection.recv(1)
            if not byte:
                raise RuntimeError('Firefox disconnected')
            if byte == b':':
                break
            size += byte
        data = b''
        while len(data) < int(size):
            data += self.connection.recv(int(size) - len(data))
        return json.loads(data)

    def call(self, name, params=None):
        self.counter += 1
        payload = json.dumps([0, self.counter, name, params or {}]).encode()
        self.connection.sendall(str(len(payload)).encode() + b':' + payload)
        result = self.receive()
        if result[2]:
            raise RuntimeError(str(result[2]))
        value = result[3]
        return value.get('value', value) if isinstance(value, dict) else value

    def script(self, script):
        return self.call('WebDriver:ExecuteScript', {'script': script, 'args': [], 'newSandbox': True, 'sandbox': 'default'})

    def wait(self, script):
        end = time.monotonic() + 25
        while time.monotonic() < end:
            result = self.script(script)
            if result:
                return result
            time.sleep(0.2)
        raise RuntimeError('Timed out: ' + script)


def run(binary, source):
    records = [dict(id='chat-a', title='Sample active chat', is_archived=False, is_starred=False, create_time=1600000000, update_time=1700000000),
               dict(id='chat-b', title='Sample archived chat', is_archived=True, is_starred=False, create_time=1600000000, update_time=1700000000)]
    mutations = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, value):
            data = json.dumps(value).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == '/api/auth/session':
                return self.reply({'accessToken': 'local-fixture-token', 'account': {'id': 'fixture-workspace'}})
            if url.path.startswith('/backend-api/'):
                assert self.headers.get('Authorization') == 'Bearer local-fixture-token'
                assert self.headers.get('ChatGPT-Account-Id') == 'fixture-workspace'
            if url.path == '/backend-api/conversations':
                params = parse_qs(url.query)
                rows = [r for r in records if not r.get('deleted') and r['is_archived'] == (params['is_archived'][0] == 'true')]
                return self.reply({'items': rows[int(params['offset'][0]):], 'total': len(rows)})
            if url.path.startswith('/backend-api/conversation/'):
                row = next(r for r in records if r['id'] == url.path.split('/')[-1])
                return self.reply(dict(row, conversation_id=row['id'], current_node='reply', mapping={'reply': {'id': 'reply', 'parent': None, 'message': {'author': {'role': 'assistant'}, 'content': {'parts': ['Firefox sample preview <b>plain text</b>']}}}}))
            data = b'<!doctype html><html><body><h1>ChatSweeper Firefox test: sample data</h1><nav><a href="/c/chat-a">Sample active chat</a></nav></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(data)

        def do_PATCH(self):
            assert self.headers.get('Authorization') == 'Bearer local-fixture-token'
            data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            row = next(r for r in records if r['id'] == self.path.split('/')[-1])
            mutations.append((row['id'], data))
            if 'is_archived' in data:
                row['is_archived'] = data['is_archived']
            if data.get('is_visible') is False:
                row['deleted'] = True
            self.reply({'success': True})

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='chatsweeper-firefox-test-') as temp:
        temp = Path(temp)
        profile = temp / 'profile'
        profile.mkdir()
        with socket.socket() as port_socket:
            port_socket.bind(('127.0.0.1', 0))
            port = port_socket.getsockname()[1]
        prefs = {'marionette.port': port, 'browser.shell.checkDefaultBrowser': False, 'browser.startup.homepage_override.mstone': 'ignore', 'datareporting.policy.dataSubmissionEnabled': False, 'toolkit.telemetry.reportingpolicy.firstRun': False}
        (profile / 'user.js').write_text('\n'.join('user_pref(%s, %s);' % (json.dumps(k), json.dumps(v)) for k, v in prefs.items()))
        env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS='1')
        with (temp / 'firefox.log').open('w') as log:
            process = subprocess.Popen([binary, '--headless', '--no-remote', '--marionette', '--profile', str(profile)], env=env, stdout=log, stderr=log)
            connection = None
            try:
                end = time.monotonic() + 35
                while time.monotonic() < end:
                    try:
                        connection = socket.create_connection(('127.0.0.1', port), timeout=1)
                        break
                    except OSError:
                        time.sleep(0.3)
                if not connection:
                    raise RuntimeError('Firefox did not start: ' + (temp / 'firefox.log').read_text()[-2000:])
                connection.settimeout(40)
                client = Protocol(connection)
                session = client.call('WebDriver:NewSession', {'capabilities': {'alwaysMatch': {'acceptInsecureCerts': False}}})
                print('Firefox version:', session.get('capabilities', {}).get('browserVersion'), flush=True)
                addon_id = client.call('Addon:Install', {'path': str(source), 'temporary': True})
                print('Production manifest installed:', addon_id, flush=True)
                client.call('Addon:Uninstall', {'id': addon_id})
                fixture = temp / 'fixture-extension'
                shutil.copytree(source, fixture)
                manifest = json.loads((fixture / 'manifest.json').read_text())
                manifest['content_scripts'][0]['matches'] = ['http://127.0.0.1/*']
                (fixture / 'manifest.json').write_text(json.dumps(manifest))
                content = (fixture / 'content.js').read_text()
                guard = next(line for line in content.splitlines() if 'test(location.origin)' in line)
                content = content.replace(guard, "  if (location.origin !== 'http://127.0.0.1:%s') return;" % server.server_port)
                (fixture / 'content.js').write_text(content)
                client.call('Addon:Install', {'path': str(fixture), 'temporary': True})
                client.call('WebDriver:Navigate', {'url': 'http://127.0.0.1:%s/' % server.server_port})
                client.wait('return !!document.getElementById("chatsweeper-root")')
                panel = 'document.getElementById("chatsweeper-root").shadowRoot'
                client.script(panel + '.getElementById("launcher").click()')
                client.wait('return ' + panel + '.getElementById("total").textContent.includes("2")')
                client.script(panel + '.getElementById("library").click()')
                ui = 'document.getElementById("chatsweeper-organizer").shadowRoot'
                client.wait('return ' + ui + '.getElementById("summary").textContent.startsWith("2 total")')
                client.script(ui + '.querySelector("#rows .title").click()')
                client.wait('return ' + ui + '.getElementById("messages").textContent.includes("Firefox sample preview")')
                assert client.script('return ' + ui + '.querySelectorAll("#messages b").length') == 0
                client.script(ui + '.getElementById("select-matches").click();' + ui + '.getElementById("archive").click();' + ui + '.getElementById("cancel").click()')
                assert not mutations
                client.script(ui + '.getElementById("archive").click();' + ui + '.getElementById("confirm").click()')
                client.wait('return ' + ui + '.getElementById("summary").textContent.includes("2 archived") && !' + ui + '.getElementById("undo").disabled')
                client.script(ui + '.getElementById("undo").click();' + ui + '.getElementById("confirm").click()')
                client.wait('return ' + ui + '.getElementById("summary").textContent.includes("1 archived")')
                assert mutations == [('chat-a', {'is_archived': True}), ('chat-a', {'is_archived': False})]
                print('PASS: installed content scripts, authenticated same-origin requests, full count, safe preview, review cancellation, archive, and undo/restore. Only local fixture records changed.', flush=True)
                client.call('WebDriver:DeleteSession')
            finally:
                if connection:
                    connection.close()
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                server.shutdown()


if __name__ == '__main__':
    run(sys.argv[1], Path(sys.argv[2]).resolve())
