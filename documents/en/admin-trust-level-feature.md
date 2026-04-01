# Admin Trust Level – Implementation Plan

This document describes a three-tier deployment security model for administrative users in MyTube.

The goal is to replace the current implicit trust boundary with an explicit, deployment-declared trust level that the backend can enforce consistently.

## Overview

Proposed deployment-level setting:

```env
MYTUBE_ADMIN_TRUST_LEVEL=application|container|host
```

Recommended default:

- `container`

Reason for the default:

- It preserves current behavior most closely.
- Today, admins effectively have backend/container-process-level capability through features such as task hooks and raw yt-dlp configuration.
- Defaulting to `application` would be a breaking behavioral change.

This setting must be:

- Deployment-scoped, not user-scoped.
- Read-only from the web UI.
- Loaded from environment variables, not persisted in the app database.

## Goals

- Make the admin trust boundary explicit and reviewable.
- Let Docker/Compose operators declare the intended security model up front.
- Gate high-risk features based on that declared model.
- Expose the active trust level to admins in a clear, read-only way.
- Preserve backward compatibility by default.

## Non-Goals

- This feature does not guarantee Docker isolation.
- This feature does not remove filesystem effects that already follow from bind mounts granted to the container.
- This feature does not redesign all admin features into sandboxed sub-systems.

## Trust Levels

### 1. `application`

Meaning:

- Admin is trusted to fully operate MyTube at the application layer.
- Admin is not treated as a shell operator, container operator, or host operator.

Expected boundary:

- Admin may manage videos, collections, settings, passwords, backups, and normal app workflows.
- Admin must not be able to intentionally execute shell commands through MyTube.
- Admin must not be able to intentionally operate on arbitrary host paths outside the normal app-owned storage model.

Implication:

- High-risk features that imply command execution or arbitrary filesystem traversal must be disabled.

### 2. `container`

Meaning:

- Admin is trusted as an operator of the MyTube backend process and its container environment.

Expected boundary:

- Admin may use features that execute with the same permissions as the backend process.
- Admin is still not treated as a host-level operator for intentionally host-scoped features.

Important note:

- In Docker deployments with bind mounts, container-level actions can naturally affect mounted host paths such as `/app/data` and `/app/uploads`. That is expected and follows from the deployment itself.
- The distinction from `host` is that MyTube does not intentionally expose arbitrary host-path features in this mode.

### 3. `host`

Meaning:

- Admin is trusted as a host-level operator for this deployment.

Expected boundary:

- Admin may use host-scoped features that intentionally operate on arbitrary absolute paths provided by the deployment or by admin input.
- This mode is appropriate only when the instance operator accepts that admin actions may intentionally reach beyond the app-owned data directories.

## Why Environment Variable Instead of App Setting

This configuration should not be stored in normal application settings because:

- App settings are writable by admins.
- A writable trust-level setting would let the actor being constrained also redefine the constraint.
- The trust boundary is a deployment property, not a user preference.

Therefore:

- Source of truth: environment variable only.
- Backend should expose the resolved value as read-only metadata.

## Proposed Backend Design

### 1. New config module

Add a backend config module that:

- Reads `MYTUBE_ADMIN_TRUST_LEVEL`.
- Accepts only `application`, `container`, and `host`.
- Falls back to `container` for missing or invalid values.
- Logs a warning for invalid values.

Suggested exported shape:

```ts
export type AdminTrustLevel = "application" | "container" | "host";

export interface DeploymentSecurityModel {
  adminTrustLevel: AdminTrustLevel;
  adminTrustedWithContainer: boolean;
  adminTrustedWithHost: boolean;
}
```

Derived booleans:

- `application` => container `false`, host `false`
- `container` => container `true`, host `false`
- `host` => container `true`, host `true`

### 2. Read-only API exposure

Expose the resolved model to the frontend through a read-only response field.

Recommended place:

- `GET /api/settings`

Recommended response shape:

```json
{
  "deploymentSecurity": {
    "adminTrustLevel": "container",
    "adminTrustedWithContainer": true,
    "adminTrustedWithHost": false,
    "source": "env"
  }
}
```

Reasons to attach it to `/api/settings`:

- Frontend already loads this endpoint.
- It is an admin-facing configuration page concern.
- No extra bootstrap request is needed.

## Proposed Frontend Design

### 1. Read-only display

Show the active trust model in Settings, ideally under Security or Advanced Settings.

UI expectations:

- Read-only badge or summary row.
- Short explanatory text for what the chosen level means.
- Optional warning banner when level is `container` or `host`.

Suggested copy:

- `application`: Admin is trusted at the application layer only.
- `container`: Admin is trusted with backend/container-process-level actions.
- `host`: Admin is trusted with host-scoped administrative actions.

### 2. Feature visibility

The frontend should hide or disable unavailable features based on the active level.

This improves usability, but backend enforcement remains mandatory.

## Feature Gating Matrix

The model only matters if it changes behavior.

Initial gating proposal:

| Capability / Feature | application | container | host |
| --- | --- | --- | --- |
| Standard app management (videos, collections, tags, login, backups) | Allowed | Allowed | Allowed |
| Task hooks upload/delete/execute | Blocked | Allowed | Allowed |
| Raw yt-dlp config text area | Blocked | Allowed | Allowed |
| Full raw yt-dlp flag passthrough | Blocked | Allowed | Allowed |
| Mount directory settings persistence | Blocked | Blocked | Allowed |
| `POST /api/scan-mount-directories` | Blocked | Blocked | Allowed |
| Future host-path maintenance features | Blocked | Blocked | Allowed |

## Enforcement Rules by Risk Area

### 1. Task hooks

Current risk:

- Hooks run with backend permissions and use `bash`.

Policy:

- `application`: disabled
- `container`: enabled
- `host`: enabled

Enforcement points:

- Hook upload route
- Hook delete route
- Hook execution path as defense in depth

Rationale:

- Hooks are explicit command execution and therefore incompatible with an application-only admin model.

### 2. Raw yt-dlp configuration

Current risk:

- Raw config is parsed from free-form text and converted into yt-dlp CLI flags.
- yt-dlp supports dangerous options such as `--exec`, `--netrc-cmd`, and plugin/config path controls.

Policy:

- `application`: raw free-form yt-dlp config disabled entirely
- `container`: current behavior allowed
- `host`: current behavior allowed

Rationale:

- A free-form text config is too broad to secure with a narrow denylist.
- If `application` mode is meant to exclude command execution, the raw config editor should not exist in that mode.

Future enhancement:

- A structured “safe yt-dlp options” UI could later be introduced for `application` mode, but that is not required for the first version.

### 3. Mount directory scanning

Current risk:

- This feature intentionally scans arbitrary absolute paths outside the normal videos directory.

Policy:

- `application`: disabled
- `container`: disabled
- `host`: enabled

Rationale:

- This is the clearest current example of a host-scoped feature.
- It should require an explicit host-level trust declaration.

## API and Validation Behavior

### 1. Request failures

When a feature is blocked by the deployment trust level, the backend should return:

- `403 Forbidden`

Suggested error shape:

```json
{
  "success": false,
  "error": "This feature is disabled by deployment security policy.",
  "requiredTrustLevel": "container"
}
```

or for host-scoped features:

```json
{
  "success": false,
  "error": "This feature requires host-level admin trust.",
  "requiredTrustLevel": "host"
}
```

### 2. Settings writes

For blocked settings fields:

- Backend should ignore or reject writes depending on endpoint semantics.

Recommended behavior:

- Reject explicit writes to blocked high-risk fields with `403`.
- Do not silently persist blocked fields.

Examples:

- In `application`, reject attempts to save `ytDlpConfig`.
- In `application` and `container`, reject attempts to save `mountDirectories`.

## Docker Compose Examples

### Application-only admin

```yaml
environment:
  - PORT=5551
  - MYTUBE_ADMIN_TRUST_LEVEL=application
```

### Container-level trusted admin

```yaml
environment:
  - PORT=5551
  - MYTUBE_ADMIN_TRUST_LEVEL=container
```

### Host-level trusted admin

```yaml
environment:
  - PORT=5551
  - MYTUBE_ADMIN_TRUST_LEVEL=host
```

## Migration and Backward Compatibility

Migration requirements:

- No database migration required.
- No settings schema migration required.

Compatibility strategy:

- Missing env var resolves to `container`.
- Existing deployments continue to behave as they do today unless the operator explicitly opts into `application` or `host`.

Behavioral changes for explicit opt-in:

- `application` intentionally disables current high-risk admin features.
- `host` intentionally enables host-scoped features beyond the `container` model.

## Testing Plan

### Backend tests

- Config parser returns `container` for missing value.
- Config parser warns and falls back for invalid value.
- Hook routes return `403` in `application`.
- Hook execution is never reached in `application`.
- Mount directory routes/settings return `403` unless level is `host`.
- Raw yt-dlp config writes return `403` in `application`.
- `GET /api/settings` includes `deploymentSecurity` metadata.

### Frontend tests

- Settings page renders the trust-level indicator correctly.
- Hook settings UI is hidden or disabled in `application`.
- Raw yt-dlp settings UI is hidden or disabled in `application`.
- Mount directory UI is hidden or disabled unless level is `host`.

## Rollout Plan

### Phase 1

- Add env parsing and read-only API exposure.
- Add Settings UI display.

### Phase 2

- Enforce backend gates for hooks, raw yt-dlp config, and mount directory features.
- Update frontend to hide blocked features.

### Phase 3

- Update user-facing docs and Docker examples.
- Clarify the issue reporting/security model language in SECURITY or docs if needed.

## Open Questions

- Whether `container` should remain the long-term default, or whether a future major release should move to `application`.
- Whether raw yt-dlp config in `application` should be fully disabled forever, or replaced with a structured allowlisted subset.
- Whether additional host-scoped features should be introduced under the `host` tier later.

## Recommended Decision

For the first implementation:

- Ship the three-tier model.
- Default to `container`.
- Treat hooks and raw yt-dlp config as `container` features.
- Treat mount directory scanning as a `host` feature.
- Keep the trust level deployment-only and read-only from the app.

This gives the project a clear answer to future security questions:

- `application`: admin is not trusted with shell/container/host-level execution
- `container`: admin is trusted with backend/container-process-level execution
- `host`: admin is trusted with host-scoped administrative actions

_End of implementation plan. Do not start implementation until explicitly approved._
