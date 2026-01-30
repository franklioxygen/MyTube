If using the provider along with yt-dlp as intended, stop reading here. The server and script will be used automatically with no intervention required.

If you are interested in using the script/server standalone for generating your own PO token, read onwards.

> [!CAUTION] 
> These endpoints and options are **unstable** and may change without notice.

# Server

**Endpoints**

- **POST /get_pot**: Generate a new POT.
    - The request data should be a JSON including:
        - `content_binding`: [Content binding](#content-binding) (optional).
        - `proxy`: A string indicating the proxy to use for the requests (optional).
        - `bypass_cache`: boolean, when set to true, bypasses any cache if present (optional).
        - `challenge`: string or null, the BotGuard challenge from Innertube (optional).
        - `disable_innertube`: boolean, when set to true, disables challenges from Innertube (optional).
        - `disable_tls_verification`: boolean, when set to true, disables TLS certificate verification. (optional)
        - `innertube_context`: object, the innertube context to be sent in the innertube request in case `challenge` is not present. Note that when available, the public IP in the innertube context is used as the cache key for POTs. (optional)
        - `source_address`: string, the cient-side IP address to bind to. (optional)
    - Returns a JSON:
        - `poToken`: The POT.
        - `contentBinding`: The generated or passed [content binding](#content-binding).
        - `expiresAt`: The expiry timestamp of the POT entry.
- **GET /ping**: Ping the server. The response includes:
    - `server_uptime`: Uptime of the server process in seconds.
    - `version`: Current server version.

# Script Method

**Options**

- `-c, --content-binding <content-binding>`: The [content binding](#content-binding), optional.
- `-p, --proxy <proxy-all>`: The proxy to use for the requests, optional.
- `-b, --bypass-cache`: See `bypass_cache` from the `POST /get_pot` endpoint.
- `-s, --source-address <source-address>`: See `source_address` from the `POST /get_pot` endpoint, optional.
- `--disable-tls-verification`: See `disable_tls_verification` from the above endpoint.
- `--version`: Print the script version and exit.
- `--verbose`: Use verbose logging.

**Environment Variables**

- **TOKEN_TTL**: The time in hours for a PO token to be considered valid. While there are no definitive answers on how long a token is valid, it has been observed to be valid for at least a couple of days (Default: 6).

### Content Binding

Content bindings refer to the data used to generate a PO Token.

GVS tokens (See [PO Tokens for GVS](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide#po-tokens-for-gvs) from the PO Token Guide) are all session-bound so the content binding for a GVS token is either a Visitor ID (also known as `visitorData`, `VISITOR_INFO1_LIVE`, used when not logged in) or the account Session ID (first part of the Data Sync ID, used when logged in).

Player tokens are mostly content-bound and their content bindings are the video IDs. Note that the `web_music` client uses the session token instead of video ID to generate player tokens.
