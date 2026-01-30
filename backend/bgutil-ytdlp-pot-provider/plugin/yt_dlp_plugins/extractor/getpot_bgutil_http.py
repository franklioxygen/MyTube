from __future__ import annotations

import functools
import json
import time

from yt_dlp.extractor.youtube.pot.provider import (
    PoTokenProviderError,
    PoTokenProviderRejectedRequest,
    PoTokenRequest,
    PoTokenResponse,
    register_preference,
    register_provider,
)
from yt_dlp.extractor.youtube.pot.utils import get_webpo_content_binding
from yt_dlp.networking.common import Request
from yt_dlp.networking.exceptions import HTTPError, TransportError

from yt_dlp_plugins.extractor.getpot_bgutil import BgUtilPTPBase


@register_provider
class BgUtilHTTPPTP(BgUtilPTPBase):
    PROVIDER_NAME = 'bgutil:http'
    DEFAULT_BASE_URL = 'http://127.0.0.1:4416'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_server_check = 0
        self._server_available = True

    @functools.cached_property
    def _base_url(self):
        base_url = self._configuration_arg('base_url', default=[None])[0]

        if base_url:
            return base_url

        # check deprecated arg
        deprecated_base_url = self.ie._configuration_arg(
            ie_key='youtube', key='getpot_bgutil_baseurl', default=[None])[0]
        if deprecated_base_url:
            self._warn_and_raise(
                "'youtube:getpot_bgutil_baseurl' extractor arg is deprecated, use 'youtubepot-bgutilhttp:base_url' instead")

        # default if no arg was passed
        self.logger.debug(
            f'No base_url provided, defaulting to {self.DEFAULT_BASE_URL}')
        return self.DEFAULT_BASE_URL

    def _check_server_availability(self, ctx: PoTokenRequest):
        if self._last_server_check + 60 > time.time():
            return self._server_available

        self._server_available = False
        try:
            self.logger.trace(
                f'Checking server availability at {self._base_url}/ping')
            response = json.load(self._request_webpage(Request(
                f'{self._base_url}/ping', extensions={'timeout': self._GET_SERVER_VSN_TIMEOUT}, proxies={'all': None}),
                note=False))
        except TransportError as e:
            # the server may be down
            script_path_provided = self.ie._configuration_arg(
                ie_key='youtubepot-bgutilscript', key='script_path', default=[None])[0] is not None

            warning_base = f'Error reaching GET {self._base_url}/ping (caused by {e.__class__.__name__}). '
            if script_path_provided:  # server down is expected, log info
                self._info_and_raise(
                    warning_base + 'This is expected if you are using the script method.')
            else:
                self._warn_and_raise(
                    warning_base + f'Please make sure that the server is reachable at {self._base_url}.')

            return
        except HTTPError as e:
            # may be an old server, don't raise
            self.logger.warning(
                f'HTTP Error reaching GET /ping (caused by {e!r})', once=True)
            return
        except json.JSONDecodeError as e:
            # invalid server
            self._warn_and_raise(
                f'Error parsing ping response JSON (caused by {e!r})')
            return
        except Exception as e:
            self._warn_and_raise(
                f'Unknown error reaching GET /ping (caused by {e!r})', raise_from=e)
            return
        else:
            self._check_version(response.get('version', ''), name='HTTP server')
            self._server_available = True
            return True
        finally:
            self._last_server_check = time.time()

    def is_available(self):
        return self._server_available or self._last_server_check + 60 < int(time.time())

    def _real_request_pot(
        self,
        request: PoTokenRequest,
    ) -> PoTokenResponse:
        if not self._check_server_availability(request):
            raise PoTokenProviderRejectedRequest(
                f'{self.PROVIDER_NAME} server is not available')

        # used for CI check
        self.logger.trace('Generating POT via HTTP server')

        disable_innertube = bool(self._configuration_arg('disable_innertube', default=[None])[0])
        challenge = self._get_attestation(None if disable_innertube else request.video_webpage)
        # The challenge is falsy when the webpage and the challenge are unavailable
        # In this case, we need to disable /att/get since it's broken for web_music
        if not challenge and request.internal_client_name == 'web_music':
            if not disable_innertube:  # if not already set, warn the user
                self.logger.warning(
                    'BotGuard challenges could not be obtained from the webpage, '
                    'overriding disable_innertube=True because InnerTube challenges '
                    'are currently broken for the web_music client. '
                    'Pass disable_innertube=1 to suppress this warning.')
            disable_innertube = True

        try:
            response = self._request_webpage(
                request=Request(
                    f'{self._base_url}/get_pot', data=json.dumps({
                        'bypass_cache': request.bypass_cache,
                        'challenge': challenge,
                        'content_binding': get_webpo_content_binding(request)[0],
                        'disable_innertube': disable_innertube,
                        'disable_tls_verification': not request.request_verify_tls,
                        'proxy': request.request_proxy,
                        'innertube_context': request.innertube_context,
                        'source_address': request.request_source_address,
                    }).encode(), headers={'Content-Type': 'application/json'},
                    extensions={'timeout': self._GETPOT_TIMEOUT}, proxies={'all': None}),
                note=f'Generating a {request.context.value} PO Token for '
                f'{request.internal_client_name} client via bgutil HTTP server',
            )
        except Exception as e:
            raise PoTokenProviderError(
                f'Error reaching POST /get_pot (caused by {e!r})') from e

        try:
            response_json = json.load(response)
        except Exception as e:
            raise PoTokenProviderError(
                f'Error parsing response JSON (caused by {e!r}). response = {response.read().decode()}') from e

        if error_msg := response_json.get('error'):
            raise PoTokenProviderError(error_msg)
        if 'poToken' not in response_json:
            raise PoTokenProviderError(
                f'Server did not respond with a poToken. Received response: {response}')

        po_token = response_json['poToken']
        self.logger.trace(f'Generated POT: {po_token}')
        return PoTokenResponse(po_token=po_token)


@register_preference(BgUtilHTTPPTP)
def bgutil_HTTP_getpot_preference(provider, request):
    return 130


__all__ = [BgUtilHTTPPTP.__name__,
           bgutil_HTTP_getpot_preference.__name__]
