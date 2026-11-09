"""Run the original CLI in this process; yt-dlp still owns all config parsing."""
import ctypes
import contextvars
import errno
import os
import runpy
import socket
import struct
# Required to wrap native yt-dlp subprocesses with the guarded Popen boundary below.
import subprocess  # nosec B404
import sys
import urllib.parse
import urllib.request


def fail(message):
    raise SystemExit('MyTube SSRF protection: ' + message)


try:
    set_policy = ctypes.CDLL(None).mytube_network_policy
    set_policy.argtypes = [ctypes.c_char_p]
    set_policy.restype = ctypes.c_int
except AttributeError:
    fail('the connection guard was not loaded; no download was started')

mode, entry, *arguments = sys.argv[1:]
sys.path[0] = os.getcwd() if mode == 'module' else (
    entry if mode == 'zip' else os.path.dirname(os.path.realpath(entry)))
import yt_dlp

original_init = yt_dlp.YoutubeDL.__init__


def guarded_init(self, params=None, *args, **kwargs):
    params = params or {}
    if os.environ.get('MYTUBE_RESET_FORMAT') == '1':
        params = dict(params, format=None, format_sort=[], format_sort_force=False)
    # Take values AFTER native config/alias/include/priority handling. Never
    # move a proxy to CLI arguments or recreate yt-dlp's NO_PROXY selection.
    proxy = params.get('proxy')
    values = [proxy] if proxy is not None else [
        value for key, value in urllib.request.getproxies().items() if key in ('http', 'https', 'all')]
    values.append(params.get('geo_verification_proxy'))
    # The bundled PO-token HTTP provider intentionally bypasses proxies. Its
    # administrator-configured service endpoint is also a trusted boundary.
    provider = sys.modules.get('yt_dlp_plugins.extractor.getpot_bgutil_http')
    if provider is not None:
        settings = params.get('extractor_args', {}).get('youtubepot-bgutilhttp', {})
        values.append((settings.get('base_url') or [provider.BgUtilHTTPPTP.DEFAULT_BASE_URL])[0])
    endpoints = []
    for value in values:
        if not value or value == '__noproxy__':
            continue
        try:
            url = urllib.parse.urlsplit(value if '://' in value else 'http://' + value)
            host = url.hostname.encode('idna').decode('ascii').rstrip('.').lower()
            try:
                host = socket.inet_ntoa(socket.inet_aton(host))
            except OSError:
                pass
            port = url.port or (1080 if url.scheme.startswith('socks') else 443 if url.scheme == 'https' else 80)
            if any(char.isspace() for char in host):
                raise ValueError('Invalid host')
            endpoints.append(f'{port} {host}\n')
        except (ValueError, AttributeError, UnicodeError):
            fail('invalid administrator proxy; refusing to connect directly')
    policy = ''.join(dict.fromkeys(endpoints))
    if not set_policy(policy.encode()):
        fail('administrator proxy policy exceeds supported size')
    os.environ['MYTUBE_NETWORK_PROXIES'] = policy
    original_init(self, params, *args, **kwargs)


yt_dlp.YoutubeDL.__init__ = guarded_init

# Only ffmpeg's network downloader is supported outside Python/libcurl. Other
# downloader executables may use direct syscalls or discard the preload policy.
# Keep all local ffmpeg postprocessing and the native HLS/DASH downloaders.
from yt_dlp.downloader.external import ExternalFD, FFmpegFD
original_download = ExternalFD.real_download
ffmpeg_route = contextvars.ContextVar('mytube_ffmpeg_route', default=None)


def guarded_download(self, filename, info):
    if not isinstance(self, FFmpegFD):
        fail('this external downloader is not supported; use native or ffmpeg')
    if any(protocol not in ('http', 'https', 'm3u8', 'm3u8_native', 'http_dash_segments')
           for protocol in info.get('protocol', '').split('+')):
        fail('this external media protocol is not supported; use HTTP(S)/HLS/DASH')
    from yt_dlp.utils.networking import clean_proxies
    proxies = self.ydl.proxies.copy()
    clean_proxies(proxies, {})
    urls = [item['url'] for item in info.get('requested_formats') or [info]]
    routes = {proxies.get(urllib.parse.urlsplit(url).scheme) or proxies.get('all') or '' for url in urls}
    if len(routes) != 1:
        fail('ffmpeg cannot use different proxies for combined inputs; use the native downloader')
    proxy = routes.pop()
    if proxy == '__noproxy__' or proxies.get('no') == '*':
        proxy = ''
    if proxy and urllib.parse.urlsplit(proxy if '://' in proxy else 'http://' + proxy).scheme != 'http':
        fail('ffmpeg cannot safely use this proxy type; use the native downloader for SOCKS/HTTPS proxies')
    token = ffmpeg_route.set(proxy)
    try:
        return original_download(self, filename, info)
    finally:
        ffmpeg_route.reset(token)


ExternalFD.real_download = guarded_download

# RTMP/RTSP and websocket downloaders do not necessarily inherit this transport.
from yt_dlp.downloader.common import FileDownloader
original_file_download = FileDownloader.download


def checked_download(self, filename, info, *args, **kwargs):
    supported = ('http', 'https', 'm3u8', 'm3u8_native', 'http_dash_segments',
                 'http_dash_segments_generator', 'ism', 'f4m', 'mhtml')
    protocol = info.get('protocol') or urllib.parse.urlsplit(info.get('url') or '').scheme
    if any(item not in supported for item in protocol.split('+')):
        fail('this media transport is not supported; use HTTP(S)/HLS/DASH')
    return original_file_download(self, filename, info, *args, **kwargs)


FileDownloader.download = checked_download

# Do not allow a setuid/static external tool to silently discard LD_PRELOAD.
original_popen = subprocess.Popen.__init__


def checked_popen(self, args, *positional, **kwargs):
    import shutil
    if len(positional) > 1:
        fail('unsupported external tool invocation; use keyword process options')
    proxy = ffmpeg_route.get()
    if proxy is not None:
        # Native ffmpeg only understands HTTP proxies, and ignores ALL_PROXY /
        # uppercase-only settings. Carry the native CLI's global proxy into its
        # environment so a configured proxy is never silently skipped.
        env = dict(os.environ if kwargs.get('env') is None else kwargs['env'])
        for key in ('HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'):
            env.pop(key, None)
        if proxy:
            env['HTTP_PROXY'] = env['http_proxy'] = proxy
        kwargs['env'] = env
    command = kwargs.get('executable') or ('/bin/sh' if kwargs.get('shell') else args if isinstance(args, (str, bytes)) else args[0])
    env = os.environ if kwargs.get('env') is None else kwargs['env']
    cwd = os.fsdecode(kwargs.get('cwd') or os.getcwd())
    search_path = os.pathsep.join(os.path.abspath(os.path.join(cwd, item)) for item in env.get('PATH', os.defpath).split(os.pathsep))
    filename = os.path.abspath(os.path.join(cwd, os.fsdecode(command))) if '/' in os.fsdecode(command) else shutil.which(command, path=search_path)
    if not filename:
        return original_popen(self, args, *positional, **kwargs)  # preserve native missing-tool errors
    with open(filename, 'rb') as file:
        header = file.read(64)
        # Opaque shell/interpreter wrappers could launch an unguarded static tool.
        dynamic = False
        if len(header) == 64 and header[:4] == b'\x7fELF' and header[4:6] == b'\x02\x01':
            offset, size, count = struct.unpack_from('<Q', header, 32)[0], *struct.unpack_from('<HH', header, 54)
            if size == 56 and count <= 4096:
                file.seek(offset)
                for _ in range(count):
                    record = file.read(size)
                    if len(record) != size:
                        break
                    if struct.unpack_from('<I', record)[0] == 3:
                        dynamic = True
    try:
        capabilities = os.getxattr(filename, 'security.capability')
    except OSError as error:
        if error.errno not in (errno.ENODATA, errno.ENOTSUP):
            fail('cannot verify external tool privileges')
        capabilities = b''
    expected = os.environ['MYTUBE_NETWORK_LIBRARY']
    preload = env.get('LD_PRELOAD', '').replace(':', ' ').split()
    if not dynamic or capabilities or os.stat(filename).st_mode & 0o6000 or expected not in preload or env.get('MYTUBE_NETWORK_PROXIES') != os.environ.get('MYTUBE_NETWORK_PROXIES'):
        fail('external tool cannot retain the connection guard')
    return original_popen(self, args, *positional, **kwargs)


subprocess.Popen.__init__ = checked_popen
sys.argv = [entry, *arguments]
if mode == 'module':
    runpy.run_module('yt_dlp', run_name='__main__', alter_sys=True)
else:
    runpy.run_path(entry, run_name='__main__')
