"""Hermetic real-client regression suite. Run on Linux after compiling the guard.
MYTUBE_TEST_YTDLP_PATH=/path/to/yt-dlp python3 nativeNetworkGuard.py
"""
import http.client
import http.server
import base64
import json
import os
from pathlib import Path
import select
import shutil
import socket
import socketserver
import ssl
import sys
import subprocess
import tempfile
import threading
import unittest
import urllib.parse

SCRIPTS = Path(os.environ['MYTUBE_TEST_GUARD_SCRIPTS']) if 'MYTUBE_TEST_GUARD_SCRIPTS' in os.environ else Path(__file__).resolve().parents[3] / 'scripts'
ENTRY = os.environ.get('MYTUBE_TEST_YTDLP_PATH') or shutil.which('yt-dlp')
ROUTER = Path(os.environ.get('MYTUBE_TEST_ROUTER', SCRIPTS / 'network-guard-route.so'))


def tunnel(left, right):
    try:
        while True:
            ready, _, _ = select.select([left, right], [], [], 10)
            if not ready:
                return
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                (right if source is left else left).sendall(data)
    finally:
        right.close()


def read_exact(sock, size):
    value = b''
    while len(value) < size:
        part = sock.recv(size - len(value))
        if not part:
            raise ConnectionError('Truncated SOCKS request')
        value += part
    return value


class GuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not ENTRY or not ROUTER.exists():
            raise RuntimeError('A real yt-dlp entry point and the test route library are required')
        cls.temp = tempfile.TemporaryDirectory(prefix='mytube-native-security-')
        cls.root = Path(cls.temp.name)
        cls.hits, cls.proxy_hits = [], []
        cls.aliases = cls.root / 'aliases'
        cls.write_aliases()
        class Origin(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                cls.hits.append(self.path)
                if self.path.startswith('/redirect'):
                    location = f'http://privatealias:{cls.secret.server_port}/secret.mp4'
                    self.send_response(302); self.send_header('Location', location); self.end_headers(); return
                if self.path.startswith('/rebind'):
                    cls.write_aliases(rebound=True)
                    self.send_response(302); self.send_header('Location', f'http://rebindalias:{cls.secret.server_port}/secret.mp4'); self.end_headers(); return
                if self.path.endswith('.m3u8'):
                    segment = (f'tcp://privatealias:{cls.secret.server_port}/segment.ts' if 'tcp' in self.path
                               else f'http://privatealias:{cls.secret.server_port}/segment.ts' if 'private' in self.path
                               else 'segment.ts')
                    body = f'#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n{segment}\n#EXT-X-ENDLIST\n'.encode()
                    mime = 'application/vnd.apple.mpegurl'
                elif self.path.endswith('.mpd'):
                    base = f'http://privatealias:{cls.secret.server_port}/' if 'private' in self.path else ''
                    body = f'<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1S" type="static"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v" bandwidth="1000" codecs="avc1.4d401e" width="16" height="16"><BaseURL>{base}</BaseURL><SegmentList duration="1"><SegmentURL media="video.mp4"/></SegmentList></Representation></AdaptationSet></Period></MPD>'.encode()
                    mime = 'application/dash+xml'
                elif self.path.endswith('.ts'):
                    body = cls.ts; mime = 'video/mp2t'
                else:
                    body = bytes(1024); mime = 'video/mp4'
                self.send_response(200); self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            def log_message(self, *args):
                pass
        class Secret(Origin):
            def do_GET(self):
                cls.hits.append('INTERNAL'); super().do_GET()
        class PublicServer(http.server.ThreadingHTTPServer):
            def get_request(self):
                connection = super().get_request(); cls.origin_connections += 1; return connection
        class PrivateServer(http.server.ThreadingHTTPServer):
            def get_request(self):
                connection = super().get_request(); cls.private_connections += 1; return connection
        cls.origin_connections = cls.private_connections = 0
        cls.origin = PublicServer(('127.0.0.1', 0), Origin)
        cls.secret = PrivateServer(('127.0.0.1', 0), Secret)
        cls.cert, cls.key = cls.root / 'cert.pem', cls.root / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=publicalias',
                        '-addext', 'subjectAltName=DNS:publicalias', '-keyout', str(cls.key), '-out', str(cls.cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.tls = PublicServer(('127.0.0.1', 0), Origin)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(cls.cert, cls.key)
        cls.tls.socket = context.wrap_socket(cls.tls.socket, server_side=True)
        class IPv6Server(PublicServer):
            address_family = socket.AF_INET6
        cls.ipv6 = IPv6Server(('::1', 0), Origin)
        class Proxy(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                cls.proxy_hits.append((self.path, self.headers.get('Proxy-Authorization')))
                target = urllib.parse.urlsplit(self.path)
                connection = http.client.HTTPConnection('127.0.0.1', cls.origin.server_port)
                connection.request('GET', target.path or '/', headers={'X-Test': self.headers.get('X-Test', '')})
                response = connection.getresponse()
                self.send_response(response.status)
                for name, value in response.getheaders():
                    if name.lower() not in ('connection', 'transfer-encoding'):
                        self.send_header(name, value)
                self.end_headers(); self.wfile.write(response.read()); connection.close()
            def do_CONNECT(self):
                cls.proxy_hits.append((self.path, self.headers.get('Proxy-Authorization')))
                self.send_response(200); self.end_headers()
                port = cls.tls.server_port if self.path.endswith(':' + str(cls.tls.server_port)) else cls.origin.server_port
                tunnel(self.connection, socket.create_connection(('127.0.0.1', port)))
            def log_message(self, *args):
                pass
        cls.proxy = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
        class Socks(socketserver.BaseRequestHandler):
            def handle(self):
                sock = self.request
                version, count = read_exact(sock, 2); read_exact(sock, count)
                sock.sendall(bytes([5, 2 if cls.require_auth else 0]))
                if cls.require_auth:
                    version, length = read_exact(sock, 2)
                    user = read_exact(sock, length); password = read_exact(sock, read_exact(sock, 1)[0])
                    cls.credentials.append(user.decode() + ':' + password.decode()); sock.sendall(bytes([1, 0]))
                version, command, reserved, kind = read_exact(sock, 4)
                if kind == 3:
                    host = read_exact(sock, read_exact(sock, 1)[0]).decode()
                else:
                    host = socket.inet_ntop(socket.AF_INET if kind == 1 else socket.AF_INET6, read_exact(sock, 4 if kind == 1 else 16))
                port = int.from_bytes(read_exact(sock, 2), 'big')
                cls.proxy_hits.append((f'{host}:{port}', None))
                upstream = socket.create_connection(('127.0.0.1', cls.origin.server_port))
                sock.sendall(bytes([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); tunnel(sock, upstream)
        cls.socks = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Socks)
        cls.require_auth, cls.credentials = False, []
        cls.socks.daemon_threads = True
        for server in (cls.origin, cls.secret, cls.proxy, cls.socks, cls.ipv6, cls.tls):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.ts = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=16x16:d=1', '-c:v', 'mpeg2video', '-f', 'mpegts', '-'])

    @classmethod
    def write_aliases(cls, rebound=False):
        cls.aliases.write_text('publicalias 93.184.216.34\nprivatealias 127.0.0.1\nproxyalias 127.0.0.1\nfakealias 198.18.0.1\nrebindalias ' + ('127.0.0.1' if rebound else '93.184.216.34') + '\n')

    @classmethod
    def tearDownClass(cls):
        for server in (cls.origin, cls.secret, cls.proxy, cls.socks, cls.ipv6, cls.tls):
            server.shutdown(); server.server_close()
        cls.temp.cleanup()

    def setUp(self):
        self.hits.clear(); self.proxy_hits.clear(); self.write_aliases()
        self.credentials.clear()
        type(self).origin_connections = type(self).private_connections = 0
        self.env = {key: value for key, value in os.environ.items() if not key.lower().endswith('_proxy')}
        self.env.update(HOME=str(self.root), XDG_CONFIG_HOME=str(self.root), HOSTALIASES=str(self.aliases),
                        LD_PRELOAD=f'{SCRIPTS / "network-guard.so"}:{ROUTER}', MYTUBE_NETWORK_LIBRARY=str(SCRIPTS / 'network-guard.so'),
                        MYTUBE_NETWORK_PROXIES='', MYTUBE_TEST_PUBLIC_PORT=str(self.origin.server_port))

    def run_cli(self, target, args=(), env=None, entry=None, defaults=True):
        output = self.root / 'out.mp4'
        output.unlink(missing_ok=True)
        command = [sys.executable, str(SCRIPTS / 'network-guard.py'), 'script', entry or ENTRY]
        command += ['--ignore-config'] if defaults else []
        command += ['--no-warnings', '--no-playlist', '--fixup', 'never', '--retries', '0', '--fragment-retries', '0',
                    '--socket-timeout', '2', '--abort-on-unavailable-fragments', '--hls-use-mpegts', '-o', str(output), *args, '--', target]
        return subprocess.run(command, env=env or self.env, cwd=self.root, capture_output=True, text=True, timeout=20)

    def public(self, path='/video.mp4'):
        return f'http://publicalias:{self.origin.server_port}{path}'

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'out.mp4').exists())
        self.assertNotIn('INTERNAL', self.hits)

    def assert_blocked(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('INTERNAL', self.hits)
        self.assertEqual(self.private_connections, 0)

    def test_direct_public_requests_and_chrome(self):
        for args in ((), ('--compat-options', 'prefer-legacy-http-handler'), ('--impersonate', 'chrome'), ('--force-ipv4',), ('--source-address', '127.0.0.1')):
            with self.subTest(args=args):
                self.assert_success(self.run_cli(self.public(), args))

    def test_native_https_certificate_validation_and_connect_proxy(self):
        env = dict(self.env, MYTUBE_TEST_PUBLIC_PORT=str(self.tls.server_port), SSL_CERT_FILE=str(self.cert))
        target = f'https://publicalias:{self.tls.server_port}/video.mp4'
        args = ('--compat-options', 'no-certifi')
        self.assert_success(self.run_cli(target, args, env=env))
        proxy = f'http://127.0.0.1:{self.proxy.server_port}'
        self.assert_success(self.run_cli(target, (*args, '--proxy', proxy), env=env))
        self.assertTrue(any(item[0].startswith('publicalias:') for item in self.proxy_hits))
        count = len(self.hits)
        wrong_name = f'https://rebindalias:{self.tls.server_port}/video.mp4'
        result = self.run_cli(wrong_name, args, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('certificate', result.stderr.lower())
        self.assertEqual(len(self.hits), count)

    def test_native_http_and_socks_proxy_credentials(self):
        target = 'http://never-resolve.invalid/video.mp4'
        proxy = f'http://user:p%40ss%25word@127.0.0.1:{self.proxy.server_port}'
        self.assert_success(self.run_cli(target, ('--proxy', proxy)))
        expected = 'Basic ' + base64.b64encode(b'user:p@ss%word').decode()
        self.assertTrue(all(item[1] == expected for item in self.proxy_hits))
        type(self).require_auth = True
        try:
            proxy = f'socks5h://user:p%40ss%25word@127.0.0.1:{self.socks.server_address[1]}'
            self.assert_success(self.run_cli(target, ('--proxy', proxy)))
            self.assertEqual(set(self.credentials), {'user:p@ss%word'})
        finally:
            type(self).require_auth = False

    def test_native_proxy_host_normalization(self):
        for host in ('127.1', 'proxyalias.'):
            with self.subTest(host=host):
                self.assert_success(self.run_cli('http://never-resolve.invalid/video.mp4', ('--proxy', f'http://{host}:{self.proxy.server_port}')))

    def test_configured_po_token_service_endpoint(self):
        plugins = self.root / 'test-plugins' / 'package' / 'yt_dlp_plugins' / 'extractor'
        plugins.mkdir(parents=True, exist_ok=True)
        (plugins / 'mytube_service_fixture.py').write_text('''
import sys, types
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.networking import Request
sys.modules['yt_dlp_plugins.extractor.getpot_bgutil_http'] = types.SimpleNamespace(BgUtilHTTPPTP=types.SimpleNamespace(DEFAULT_BASE_URL='http://127.0.0.1:1'))
class MyTubeServiceFixtureIE(InfoExtractor):
    _VALID_URL = r'http://publicalias:(?P<id>\\d+)/test-pot-service'
    def _real_extract(self, url):
        service = self.get_param('extractor_args')['youtubepot-bgutilhttp']['base_url'][0]
        self._downloader.urlopen(Request(service + '/ping', proxies={'all': None})).close()
        return {'id': 'fixture', 'title': 'fixture', 'url': url.replace('/test-pot-service', '/video.mp4'), 'ext': 'mp4'}
''')
        args = ('--plugin-dirs', str(plugins.parents[2]), '--extractor-args', f'youtubepot-bgutilhttp:base_url=http://privatealias:{self.secret.server_port}')
        result = self.run_cli(self.public('/test-pot-service'), args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / 'out.mp4').exists())
        self.assertIn('INTERNAL', self.hits)  # Only this explicit service endpoint is trusted.
        self.assertGreater(self.private_connections, 0)

    def test_utf16_config_is_parsed_natively(self):
        config = self.root / 'utf16.conf'
        config.write_text(f'--proxy http://127.0.0.1:{self.proxy.server_port}\n', encoding='utf-16')
        self.assert_success(self.run_cli('http://never-resolve.invalid/video.mp4', ('--config-locations', str(config))))
        self.assertTrue(self.proxy_hits)

    def test_public_ipv6_and_native_ipv6_binding(self):
        env = dict(self.env, MYTUBE_TEST_PUBLIC_PORT=str(self.ipv6.server_port))
        self.assert_success(self.run_cli(f'http://[2606:4700:4700::1111]:{self.ipv6.server_port}/video.mp4', ('--force-ipv6',), env=env))

    def test_private_ranges_at_socket_boundary(self):
        for address in ('0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
                        '192.168.1.1', '198.18.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1'):
            for operation in ('connect', 'sendto', 'sendmsg', 'sendmmsg'):
                with self.subTest(address=address, operation=operation):
                    script = """
import ctypes, errno, socket, struct, sys
host, operation = sys.argv[1:]
with socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET, socket.SOCK_STREAM if operation == 'connect' else socket.SOCK_DGRAM) as sock:
 try:
  if operation == 'connect': sock.connect((host, 12345))
  elif operation == 'sendto': sock.sendto(b'test', (host, 12345))
  elif operation == 'sendmsg': sock.sendmsg([b'test'], [], 0, (host, 12345))
  else:
   class Iovec(ctypes.Structure): _fields_ = [('base', ctypes.c_void_p), ('size', ctypes.c_size_t)]
   class Message(ctypes.Structure): _fields_ = [('name', ctypes.c_void_p), ('namelen', ctypes.c_uint), ('iov', ctypes.POINTER(Iovec)), ('iovlen', ctypes.c_size_t), ('control', ctypes.c_void_p), ('controllen', ctypes.c_size_t), ('flags', ctypes.c_int)]
   class Batch(ctypes.Structure): _fields_ = [('message', Message), ('length', ctypes.c_uint)]
   family = socket.AF_INET6 if ':' in host else socket.AF_INET
   raw = struct.pack('=H', family) + struct.pack('!H', 12345) + (bytes(4) + socket.inet_pton(family, host) + bytes(4) if family == socket.AF_INET6 else socket.inet_aton(host) + bytes(8))
   name, data = ctypes.create_string_buffer(raw), ctypes.create_string_buffer(b'test')
   iov = Iovec(ctypes.cast(data, ctypes.c_void_p), 4)
   message = Batch(Message(ctypes.cast(name, ctypes.c_void_p), len(raw), ctypes.pointer(iov), 1, None, 0, 0), 0)
   if ctypes.CDLL(None, use_errno=True).sendmmsg(sock.fileno(), ctypes.byref(message), 1, 0) < 0:
    raise OSError(ctypes.get_errno(), 'sendmmsg')
 except OSError as error: assert error.errno == errno.EACCES, error
 else: raise AssertionError('Private socket was not blocked')
"""
                    result = subprocess.run([sys.executable, '-c', script, address, operation], env=self.env, capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('blocked private/internal connection', result.stderr)

    def test_private_dns_redirect_and_rebinding(self):
        for args in ((), ('--compat-options', 'prefer-legacy-http-handler'), ('--impersonate', 'chrome')):
            for path in ('private', 'redirect', 'rebind'):
                with self.subTest(args=args, path=path):
                    self.write_aliases()
                    target = f'http://privatealias:{self.secret.server_port}/secret.mp4' if path == 'private' else self.public('/' + path)
                    self.assert_blocked(self.run_cli(target, args))

    def test_policy_bounds_and_closed_stderr_still_deny(self):
        script = """
import ctypes, errno, os, socket
library = ctypes.CDLL(None)
policy = library.mytube_network_policy
policy.argtypes = [ctypes.c_char_p]
policy.restype = ctypes.c_int
assert policy(None) == 0
assert policy(b'x' * 65536) == 0
assert policy(b'x' * 65535) == 1
assert policy(b'') == 1
os.close(2)
with socket.socket() as sock:
 try: sock.connect(('127.0.0.1', 12345))
 except OSError as error: assert error.errno == errno.EACCES, error
 else: raise AssertionError('Private socket was not blocked with closed stderr')
"""
        result = subprocess.run([sys.executable, '-c', script], env=self.env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_hls_dash_and_ffmpeg(self):
        for path, args in (('/media.m3u8', ()), ('/media.m3u8', ('--downloader', 'ffmpeg')), ('/media.mpd', ())):
            with self.subTest(path=path, args=args):
                self.assert_success(self.run_cli(self.public(path), args))

    def test_private_fragments_and_raw_tcp(self):
        for path, args in (('/private.m3u8', ()), ('/private.m3u8', ('--downloader', 'ffmpeg')),
                           ('/tcp.m3u8', ('--downloader', 'ffmpeg')), ('/private.mpd', ())):
            with self.subTest(path=path, args=args):
                result = self.run_cli(self.public(path), args)
                self.assertIn(path, self.hits)
                self.assert_blocked(result)
                if 'tcp' not in path:
                    self.assertIn('blocked private/internal connection', result.stderr)

    def test_ffmpeg_raw_tcp_is_blocked_at_connect(self):
        result = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f'tcp://privatealias:{self.secret.server_port}/segment.ts', '-f', 'null', '-'],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assert_blocked(result)
        self.assertIn('blocked private/internal connection', result.stderr)

    def test_native_config_aliases_nested_files_and_remote_dns(self):
        for scheme, port in (('http', self.proxy.server_port), ('socks5', self.socks.server_address[1]), ('socks5h', self.socks.server_address[1])):
            for host in ('never-resolve.invalid', 'fakealias'):
                with self.subTest(scheme=scheme, host=host):
                    self.proxy_hits.clear()
                    nested = self.root / 'nested.conf'; nested.write_text('--add-header "X-Test: from nested config"\n')
                    config = self.root / 'native.conf'
                    config.write_text(f'--config-locations "{nested}"\n--alias route "--proxy {{0}}"\n--route {scheme}://proxyalias:{port}\n')
                    self.assert_success(self.run_cli(f'http://{host}/video.mp4', ('--config-locations', str(config))))
                    self.assertTrue(self.proxy_hits)
                    self.assertTrue(all(host in item[0] for item in self.proxy_hits))

    def test_hls_dash_through_trusted_http_and_socks_proxies(self):
        for scheme, port in (('http', self.proxy.server_port), ('socks5h', self.socks.server_address[1])):
            for path in ('/media.m3u8', '/media.mpd'):
                with self.subTest(scheme=scheme, path=path):
                    self.proxy_hits.clear()
                    config = self.root / 'stream-proxy.conf'
                    config.write_text(f'--proxy {scheme}://proxyalias:{port}\n')
                    self.assert_success(self.run_cli('http://never-resolve.invalid' + path, ('--config-locations', str(config))))
                    self.assertTrue(self.proxy_hits)
                    self.assertTrue(all('never-resolve.invalid' in item[0] for item in self.proxy_hits))

    def test_pip_portable_config_keeps_proxy(self):
        import yt_dlp
        site = self.root / 'portable-site'; site.mkdir(exist_ok=True)
        package = site / 'yt_dlp'
        if not package.exists():
            package.symlink_to(Path(yt_dlp.__file__).parent, target_is_directory=True)
        entry = self.root / 'pip-entry'
        entry.write_text(f'#!{sys.executable}\nfrom yt_dlp import main\nmain()\n')
        (site / 'yt-dlp.conf').write_text(f'--proxy http://127.0.0.1:{self.proxy.server_port}\n--ignore-config\n')
        env = dict(self.env, PYTHONPATH=str(site))
        self.assert_success(self.run_cli('http://never-resolve.invalid/video.mp4', env=env, entry=str(entry), defaults=False))
        self.assertTrue(self.proxy_hits)

    def test_proxy_environment_no_proxy_and_default_ports_are_native(self):
        proxy = f'http://127.0.0.1:{self.proxy.server_port}'
        for args in ((), ('--compat-options', 'prefer-legacy-http-handler'), ('--impersonate', 'chrome')):
            for value in ('never-resolve.invalid:80', 'never-resolve.invalid:443', 'unrelated.example'):
                with self.subTest(args=args, no_proxy=value):
                    # Compare native and guarded routing, including backend differences.
                    env = dict(self.env, HTTP_PROXY=proxy, HTTPS_PROXY=proxy, NO_PROXY=value)
                    baseline_env = {k: v for k, v in env.items() if k not in ('LD_PRELOAD', 'MYTUBE_NETWORK_LIBRARY')}
                    target = 'http://never-resolve.invalid:80/video.mp4'
                    baseline = subprocess.run([ENTRY, '--ignore-config', '--no-warnings', '--simulate', '--socket-timeout', '2', *args, '--', target],
                                              env=baseline_env, capture_output=True, text=True, timeout=15)
                    self.proxy_hits.clear()
                    actual = self.run_cli(target, args=args, env=env)
                    self.assertEqual(actual.returncode == 0, baseline.returncode == 0, actual.stderr)

    def test_no_proxy_direct_remains_guarded(self):
        env = dict(self.env, HTTP_PROXY=f'http://127.0.0.1:{self.proxy.server_port}', NO_PROXY='privatealias')
        self.assert_blocked(self.run_cli(f'http://privatealias:{self.secret.server_port}/secret.mp4', env=env))
        self.assertFalse(self.proxy_hits)

    def test_ffmpeg_honors_uppercase_and_all_http_proxy(self):
        for key in ('HTTP_PROXY', 'ALL_PROXY'):
            with self.subTest(key=key):
                self.proxy_hits.clear()
                env = dict(self.env, **{key: f'http://127.0.0.1:{self.proxy.server_port}'})
                self.assert_success(self.run_cli('http://never-resolve.invalid/media.m3u8', ('--downloader', 'ffmpeg'), env=env))
                self.assertTrue(self.proxy_hits)

    def test_unsupported_ffmpeg_proxy_fails_without_direct_fallback(self):
        env = dict(self.env, ALL_PROXY=f'socks5h://127.0.0.1:{self.socks.server_address[1]}')
        result = self.run_cli('http://never-resolve.invalid/media.m3u8', ('--downloader', 'ffmpeg'), env=env)
        self.assert_blocked(result)
        self.assertIn('use the native downloader', result.stderr)

    def test_format_retry_retains_proxy(self):
        config = self.root / 'retry.conf'
        config.write_text(f'--proxy http://127.0.0.1:{self.proxy.server_port}\n--format impossible-format\n')
        target = 'http://never-resolve.invalid/video.mp4'
        first = self.run_cli(target, ('--config-locations', str(config)))
        self.assertNotEqual(first.returncode, 0)
        self.proxy_hits.clear()
        self.assert_success(self.run_cli(target, ('--config-locations', str(config)), env=dict(self.env, MYTUBE_RESET_FORMAT='1')))
        self.assertTrue(self.proxy_hits)

    def test_proxy_failure_never_connects_direct(self):
        result = self.run_cli(self.public(), ('--proxy', 'http://127.0.0.1:1'))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.hits, [])
        self.assertEqual(self.origin_connections, 0)

    def test_missing_preload_fails_before_download(self):
        env = {k: v for k, v in self.env.items() if k != 'LD_PRELOAD'}
        result = self.run_cli(self.public(), env=env)
        self.assertIn('guard was not loaded', result.stderr)
        self.assertEqual(self.hits, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
