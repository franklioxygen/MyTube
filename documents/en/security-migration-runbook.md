# Security Migration Runbook (Single Instance)

This runbook is designed for one instance at a time.
Use it for test and production migrations, including direct full cutover.

## Preconditions

- You have operator access to deployment environment.
- You can create database backups.
- You can update environment variables and restart backend.
- You can access backend logs and security audit logs.

## Step 1: Create Pre-Migration Snapshot

Capture:
- database backup file ID/checksum
- current `backend/.env` security-related values
- current app version/build tag

Recommended commands:

```bash
npm --prefix backend run security-migration:scan -- --format markdown --out data/security-migration-report-pre.md
```

## Step 2: Dry-Run Migration Scan

Run dry-run scan and archive output:

```bash
npm --prefix backend run security-migration:scan -- --format json --out data/security-migration-report-pre.json
```

If high-risk findings exist, do not cut over yet.

## Step 3: Remediate Findings and Re-Scan

Typical remediations:
- remove legacy `.sh` hooks
- clear free-form `ytDlpConfig` text
- migrate mount settings to `PLATFORM_MOUNT_DIRECTORIES`
- disable in-app cloudflared control

Re-scan:

```bash
npm --prefix backend run security-migration:scan -- --format json --out data/security-migration-report-post.json --assert-clean
```

`--assert-clean` exits non-zero if high-risk items remain.

## Step 4: Choose Cutover Mode

Shared settings:
- `SECURITY_MODEL=strict`
- `HOOK_EXECUTION_MODE=worker` for production isolation
- `SECURITY_AUDIT_RETENTION_DAYS=90`
- `SECURITY_ALERT_WINDOW_RETENTION_DAYS=7`

Mode A (recommended): canary then full rollout
- migrate a canary subset first
- observe one peak window
- then expand to full scope

Mode B (operator override): direct full cutover (no canary)
- migrate full target scope in one change window
- required before execution:
  - `--assert-clean` scan passed
  - rollback path prepared (version rollback or temporary legacy fallback in approved window)
  - operator confirms business impact risk acceptance

## Step 5: Post-Cutover Validation and Archive

After cutover (canary or direct full):
- validate admin login, downloads, mount scan, playback, and alert signals
- validate password recovery uses `x-mytube-recovery-token` header or request body only (query string tokens are rejected)
- validate legacy API consumers can still read the deprecated `mountDirectories` alias but cannot write it
- archive final records:
  - pre/post scan reports
  - change summary
  - residual risks
  - decision log (including why canary was used or skipped)

## Step 6: Rollback (If Threshold Triggered)

Rollback choices:
- preferred: version rollback
- temporary: `SECURITY_MODEL=legacy` only during approved migration window

Every rollback must record:
- trigger reason
- impact scope
- recovery start/end time
- owner and follow-up remediation task

## Idempotency Requirement

Migration scan is read-only and repeatable:
- repeated dry-run scans do not mutate state
- report format remains stable for archiving and diffing
