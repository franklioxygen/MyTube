# Deployment Security Model

This document explains the three deployment security modes for administrative users in MyTube.

Configure the active mode with:

```env
MYTUBE_ADMIN_TRUST_LEVEL=application|container|host
```

If the variable is missing or invalid, MyTube falls back to:

```env
MYTUBE_ADMIN_TRUST_LEVEL=container
```

## Why This Exists

Some admin-only features stay within normal app management, while others can cross into backend process, container, or host-path behavior.

The deployment security model makes that boundary explicit:

- `application`: admin is trusted to operate the app, but not to execute backend/container-level actions
- `container`: admin is trusted with backend/container-process-level actions
- `host`: admin is trusted with host-scoped administrative actions

This is a deployment decision, not a user preference. The backend reads it from the environment and exposes it to the UI as read-only metadata.

## Choosing a Mode

### `application`

Choose this when:

- you want admin users to manage MyTube normally
- you do not want admin users to upload or run shell-based hooks
- you do not want admin users to use raw yt-dlp passthrough features
- you do not want admin users to manage arbitrary host-style mount directory features

This is the most restrictive mode.

Use it if you want admin to stay at the application layer only.

### `container`

Choose this when:

- you trust admin users to use backend/container-process-level features
- you want task hooks and raw yt-dlp configuration available
- you do not want to expose host-scoped mount directory features

This is the default because it is closest to MyTube's current behavior.

### `host`

Choose this when:

- you intentionally trust admin users as deployment operators
- you want mount directory settings and mount directory scanning available
- you accept host-scoped maintenance features as part of the trust model

Use this only when the deployment operator explicitly accepts that boundary.

## Capability Matrix

| Capability / Feature | application | container | host |
| --- | --- | --- | --- |
| Standard app management (videos, collections, tags, login, backups) | Yes | Yes | Yes |
| Task hooks upload/delete/execute | No | Yes | Yes |
| Raw yt-dlp config text area | No | Yes | Yes |
| Full raw yt-dlp flag passthrough | No | Yes | Yes |
| Mount directory settings persistence | No | No | Yes |
| Scan files from configured mount directories | No | No | Yes |
| Future host-path maintenance features | No | No | Yes |

## What The Modes Mean In Practice

### Application Mode

Admins can still:

- manage videos, collections, tags, backups, users, and normal settings
- use normal download workflows that do not depend on raw passthrough features

Admins cannot:

- upload, delete, or execute task hook scripts
- use the raw yt-dlp configuration text area
- persist or scan mount directories

### Container Mode

Admins can additionally:

- upload, delete, and execute task hooks
- use raw yt-dlp configuration and raw flag passthrough

Admins still cannot:

- use host-scoped mount directory management features

Important note:

- in Docker, container-level behavior can still affect mounted paths such as `/app/data` or `/app/uploads` if your deployment bind-mounts them
- that effect comes from the deployment itself, not from MyTube treating admin as a host operator

### Host Mode

Admins can additionally:

- save mount directory settings
- scan files from configured mount directories
- use future host-path maintenance features that may be added under this trust level

## Example Configurations

### Docker Compose

```yaml
environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=application
```

```yaml
environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=container
```

```yaml
environment:
  - MYTUBE_ADMIN_TRUST_LEVEL=host
```

Permission note for upgrades:

- the container entrypoint now starts as `root` only long enough to reconcile bind-mount ownership, then launches the backend as `PUID:PGID` (default `1000:1000`)
- if you are upgrading an older bind-mounted deployment, MyTube will try to repair `uploads` and `data` ownership automatically during startup
- if your host files are intentionally owned by a different user, set matching `PUID` and `PGID` values in your compose file or `.env`
- this still applies to existing subdirectories such as `uploads/images-small`; if the host filesystem rejects `chown`, thumbnail generation or scans can still fail with `EACCES`

Example fix on the host:

```bash
chown -R 1000:1000 /path/to/mytube/uploads /path/to/mytube/data
```

### Local Source Run

```bash
MYTUBE_ADMIN_TRUST_LEVEL=application npm run dev
```

```bash
export MYTUBE_ADMIN_TRUST_LEVEL=host
npm run dev
```

Or set it in `backend/.env`.

## UI Behavior

The Settings page shows the active deployment security model as read-only information.

The UI also hides or disables features that are not allowed in the current mode. Backend enforcement still applies even if a client attempts to call restricted APIs directly.

## Recommendation

Use:

- `application` if admin should stay at the application layer only
- `container` if admin should be trusted with backend/container-process-level features
- `host` only if admin should be treated as a host-scoped deployment operator

If you are unsure, start with `container` only when you need hooks or raw yt-dlp passthrough. Otherwise prefer `application`.

## Session Signing Key (`JWT_SECRET`)

`JWT_SECRET` is optional. When it is unset or empty, the backend generates a
random signing key at startup rather than falling back to a shared constant.

This is safe because signed tokens never leave the process: login mints one, the
server immediately exchanges it for an opaque session id stored in memory, and
no response body returns a token. Auth sessions do not survive a restart in
either configuration, so a per-process key costs nothing.

Do not set `JWT_SECRET` to
`default_development_secret_do_not_use_in_production`. That value was published
in earlier releases, so anyone can forge tokens with it. The backend refuses to
start if it is configured.

## Gesture Login (`GESTURE_LOGIN_PEPPER`)

Gesture Login lets the single admin sign in by drawing a pattern on a 3x3 grid
instead of typing the admin password. It is off until an admin enrolls one, and
it changes nothing about visitor accounts, passkeys, or API keys.

**Treat it as a convenience, not as a second password.** A three-dot pattern has
roughly 320 possibilities and even the full nine-dot space is far smaller than a
real password. Do not present it to users as equivalent security. The design
compensates in three ways, none of which turn a gesture into a strong
credential:

- The stored verifier is HMAC'd under a server-side pepper and then run through
  memory-hard scrypt with a per-credential salt, so a database-only leak is not
  enough to attack it offline.
- Three incorrect gestures lock the method permanently. Only a successful admin
  password login clears the lock; waiting, restarting, passkey login, and
  visitor login do not. A streak of one or two clears itself twelve hours after
  the most recent wrong attempt.
- Password login cannot be disabled while a gesture is configured, because a
  password login is the only way out of that lock. The API rejects the attempt
  even if a stale browser tab tries it.

The drawn pattern travels in the request body exactly as a password does, so
**use HTTPS**. On a plain-HTTP LAN deployment, anyone who can see the traffic can
replay the gesture.

### The pepper file

The pepper is resolved in this order:

1. `GESTURE_LOGIN_PEPPER`, if set and at least 32 bytes.
2. Otherwise a file generated on first enrollment at
   `backend/data/gesture-login.pepper`, beside `mytube.db`, created with
   owner-only permissions.

`JWT_SECRET` and `CSRF_SECRET` are deliberately not reused: both fall back to a
fresh random value per process, so either would silently invalidate an enrolled
gesture on every restart.

**The pepper is not inside the database.** A database export alone does not carry
it. Restoring `mytube.db` onto a new installation therefore produces a
credential the new server cannot verify: Gesture Login reports that it needs to
be set up again, the login grid disappears, and the admin signs in with their
password and redraws. Nothing else is affected.

To avoid that, either back up the whole data directory rather than just the
database, or set `GESTURE_LOGIN_PEPPER` explicitly so the secret travels with
your configuration instead of a generated file. Changing or losing the pepper
never locks anyone out — password login is always the recovery path.

### Restoring a backup

Importing a database or restoring from a backup replaces the credential row
along with everything else. A backup taken before a lock will therefore clear
that lock, and one taken while enrolled restores that gesture. This is an
admin-only action, and an admin who can restore a backup can already delete the
credential outright, but it is worth knowing that it is the one exception to
"only a password login unlocks it".

## Data Directory (`MYTUBE_BACKEND_DATA_DIR`)

`MYTUBE_BACKEND_DATA_DIR` is optional and defaults to `<backend cwd>/data`. It
holds `mytube.db`, the generated Gesture Login pepper, uploaded hooks, and the
legacy JSON files. Set it to keep that state on a different volume from the
code; a relative value is resolved against the backend's working directory.

It relocates the data directory only. Media stays under `uploads/`, which
continues to follow the backend's working directory.

The backend test suite sets this to a scratch directory per test file, so
running `npm test` never touches a real deployment's database.

**Do not confuse it with `MYTUBE_DATA_DIR`**, which the shipped Compose stack and
the Docker guide use for the *host* side of the `<host>:/app/data` bind mount.
The backend deliberately ignores that variable: its value is a host path, so
reading it inside the container pointed the backend at a directory holding no
database. It opened a new one instead, and a fresh database defaults to
`loginEnabled: false` — an upgrade turned a password-protected instance into a
public one. In a container, set `MYTUBE_BACKEND_DATA_DIR` only if you have also
mounted your data at that path.

If the resolved data directory holds no database while a populated `mytube.db`
sits at the default location — or at the path `MYTUBE_DATA_DIR` names — the
backend refuses to start and names both. Starting there would create an empty
database, and an empty database has login protection off. A first install, where
no other database exists, starts normally.
