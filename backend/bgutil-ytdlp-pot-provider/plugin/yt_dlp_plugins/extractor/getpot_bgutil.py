from __future__ import annotations

__version__ = '1.2.2'

import abc
import json

from yt_dlp.extractor.youtube.pot.provider import (
    ExternalRequestFeature,
    PoTokenContext,
    PoTokenProvider,
    PoTokenProviderRejectedRequest,
)
from yt_dlp.extractor.youtube.pot.utils import WEBPO_CLIENTS
from yt_dlp.utils import js_to_json
from yt_dlp.utils.traversal import traverse_obj


class BgUtilPTPBase(PoTokenProvider, abc.ABC):
    PROVIDER_VERSION = __version__
    BUG_REPORT_LOCATION = 'https://github.com/Brainicism/bgutil-ytdlp-pot-provider/issues'
    _SUPPORTED_EXTERNAL_REQUEST_FEATURES = (
        ExternalRequestFeature.PROXY_SCHEME_HTTP,
        ExternalRequestFeature.PROXY_SCHEME_HTTPS,
        ExternalRequestFeature.PROXY_SCHEME_SOCKS4,
        ExternalRequestFeature.PROXY_SCHEME_SOCKS4A,
        ExternalRequestFeature.PROXY_SCHEME_SOCKS5,
        ExternalRequestFeature.PROXY_SCHEME_SOCKS5H,
        ExternalRequestFeature.SOURCE_ADDRESS,
        ExternalRequestFeature.DISABLE_TLS_VERIFICATION,
    )
    _SUPPORTED_CLIENTS = WEBPO_CLIENTS
    _SUPPORTED_CONTEXTS = (
        PoTokenContext.GVS,
        PoTokenContext.PLAYER,
        PoTokenContext.SUBS,
    )
    _GETPOT_TIMEOUT = 20.0
    _GET_SERVER_VSN_TIMEOUT = 5.0
    _MIN_NODE_VSN = (18, 0, 0)

    def _info_and_raise(self, msg, raise_from=None):
        self.logger.info(msg)
        raise PoTokenProviderRejectedRequest(msg) from raise_from

    def _warn_and_raise(self, msg, once=True, raise_from=None):
        self.logger.warning(msg, once=once)
        raise PoTokenProviderRejectedRequest(msg) from raise_from

    def _check_version(self, got_version, *, default='unknown', name):
        def _major(version):
            return version.split('.', 1)[0]

        if got_version != self.PROVIDER_VERSION:
            self.logger.warning(
                f'The provider plugin and the {name} are on different versions, '
                f'this may cause compatibility issues. '
                f'Please ensure they are on the same version. '
                f'Otherwise, help will NOT be provided for any issues that arise. '
                f'(plugin: {self.PROVIDER_VERSION}, {name}: {got_version or default})',
                once=True)

        if not got_version or _major(got_version) != _major(self.PROVIDER_VERSION):
            self._warn_and_raise(
                f'Plugin and {name} major versions are mismatched. '
                f'Update both the plugin and the {name} to the same version to proceed.')

    def _get_attestation(self, webpage: str | None):
        if not webpage:
            return None
        raw_challenge_data = self.ie._search_regex(
            r'''(?sx)window\.ytAtR\s*=\s*(?P<raw_cd>(?P<q>['"])
                (?:
                    \\.|
                    (?!(?P=q)).
                )*
            (?P=q))\s*;''',
            webpage,
            'raw challenge data',
            default=None,
            group='raw_cd',
        )
        att_txt = traverse_obj(raw_challenge_data, ({js_to_json}, {json.loads}, {json.loads}, 'bgChallenge'))
        if not att_txt:
            self.logger.warning('Failed to extract initial attestation from the webpage')
            return None
        return att_txt


__all__ = ['__version__']
