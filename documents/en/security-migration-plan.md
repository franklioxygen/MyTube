# Security Migration Plan (3 Phases)

This document defines the rollout phases for the strict security model.
All dates below are target windows and should be adjusted by release manager if needed.

## Timeline

- Phase 1 (`vNext`): April 15, 2026
- Phase 2 (`vNext+1`): May 20, 2026
- Phase 3 (`vNext+2`): June 24, 2026

## Phase 1 (`vNext`) - Visibility and Compatibility

Goal:
- Ship strict model foundation and migration observability without immediate hard break for upgraded instances.

Default behavior:
- New installations default to `SECURITY_MODEL=strict`.
- Upgraded instances can temporarily keep `SECURITY_MODEL=legacy` during migration window.

Implementation:
- Enforce `SECURITY_MODEL` fail-closed startup validation in production.
- Provide migration scan tooling and report output:
  - `npm --prefix backend run security-migration:scan -- --format markdown --out data/security-migration-report.md`
- Emit security audit/alert signals for high-risk control plane access.

Exit criteria:
- Every upgraded instance has a scan report and owner.
- High-risk findings have remediation plans and deadlines.
- No widespread auth/download regressions.

## Phase 2 (`vNext+1`) - Secure by Default

Goal:
- Make strict mode default for upgraded instances.

Default behavior:
- Upgraded instances default to `strict`.
- `legacy` is explicit, temporary, and auditable only.

Implementation:
- Enforce unauthenticated write denial by default.
- Keep bootstrap one-time and atomic.
- Keep strict controls for:
  - hooks shell execution (disabled)
  - free-form `ytDlpConfig` text passthrough (disabled)
  - `mountDirectories` API write (disabled)

Exit criteria:
- Most instances stable under strict mode.
- Legacy usage drops to controlled low levels with tracked owners.

## Phase 3 (`vNext+2`) - Legacy Removal

Goal:
- Remove legacy model and finalize trust boundary.

Default behavior:
- Only `SECURITY_MODEL=strict` is supported.

Implementation:
- Remove legacy code paths/config/docs.
- Keep only declarative hook actions and allowlisted safe configs.
- Remove legacy-compatible API entry points and UI affordances.

Exit criteria:
- No legacy branch in code.
- Security tests and CI gates pass.
- Release notes explicitly list breaking changes and replacements.

## Rollback Policy by Phase

- `vNext`: version rollback allowed; temporary `legacy` allowed with audit.
- `vNext+1`: temporary `legacy` rollback allowed only with expiration + ticket.
- `vNext+2`: only version rollback; no runtime fallback to `legacy`.
