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
