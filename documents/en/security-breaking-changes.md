# Security Breaking Changes Matrix

This is the external contract for security-model migration.
All client/integration teams should follow this document.

## Error Semantics

- `401`: unauthenticated (missing/invalid auth session)
- `403`: authenticated but not authorized, or feature disabled by strict policy
- `409`: conflict (for example bootstrap already completed)

## API and Config Changes

| Change | Old Behavior | New Behavior | Effective Phase | Replacement |
| --- | --- | --- | --- | --- |
| Unauthenticated write APIs | Could be allowed when `loginEnabled=false` | `strict`: denied by default (`401`/`403`); temporary `legacy`: historical compatibility preserved while `loginEnabled=false` | `vNext+1` default, `vNext+2` mandatory | Authenticate as admin/session first; use `legacy` only during approved migration window |
| `passkeys/register` | Previously weak/public path in legacy behavior | Admin-only operation | `vNext+1` | Use authenticated admin session |
| `reset-password` | Could be reached as public flow | Admin session or one-time recovery token only | `vNext+1` | Controlled recovery token flow |
| Hooks shell execution | User scripts/commands could execute | Shell execution disabled | `vNext+1` default, `vNext+2` mandatory | Declarative hook actions (`notify_webhook`) |
| `ytDlpConfig` free text | Arbitrary text passthrough | Structured allowlist only | `vNext+1` default, `vNext+2` mandatory | `ytDlpSafeConfig` fields |
| `mountDirectories` API write | Could submit host absolute paths | API write blocked; platform allowlist only | `vNext+1` default, `vNext+2` mandatory | `PLATFORM_MOUNT_DIRECTORIES` |
| In-app cloudflared control | App Admin could toggle process control | Disabled in strict control plane | `vNext+1` | Platform/operator managed tunnel lifecycle |

## Client Migration Examples

## Example 1: Reset Password

Old:
- Client calls public `POST /api/settings/reset-password`.

New:
1. Admin authenticates.
2. Admin requests `POST /api/settings/reset-password/recovery-token`.
3. Client calls `POST /api/settings/reset-password` with one-time token.

## Example 2: Hooks

Old:
- Upload `.sh` scripts and rely on shell execution.

New:
1. Upload JSON hook definition.
2. Use only declarative action types.
3. For production, set `HOOK_EXECUTION_MODE=worker`.

## Example 3: Mount Directories

Old:
- Save absolute host paths via settings API.

New:
1. Platform operator configures `PLATFORM_MOUNT_DIRECTORIES`.
2. App Admin selects directory IDs only.

## Rollback and Compatibility Window

- During `vNext` and limited `vNext+1`, temporary `SECURITY_MODEL=legacy` may be used only with audit record.
- In `vNext+2`, runtime fallback to `legacy` is removed.
- For severe regressions, use version rollback.

## Latest Migration Versions

- Migration scan should report:
  - `strictSecurityMigrationVersion >= 1`
  - `ytDlpSafeConfigMigrationVersion >= 1`
