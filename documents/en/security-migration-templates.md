# Security Migration Templates

Use these templates for archivable migration records.

## Template 1: Migration Report

```markdown
# Security Migration Report

- Instance:
- Environment:
- Date:
- Operator:
- Approver:
- Target phase: vNext / vNext+1 / vNext+2

## Pre-Checks

- Backup ID:
- SECURITY_MODEL before:
- Version / image tag:

## Scan Summary

- Report file:
- High:
- Medium:
- Low:
- Info:

## Changes Applied

- [ ] SECURITY_MODEL updated
- [ ] Hook scripts removed / migrated
- [ ] ytDlpConfig migrated
- [ ] mount directories migrated
- [ ] cloudflared control moved to platform layer

## Validation

- [ ] Login
- [ ] Download
- [ ] Scan
- [ ] Playback
- [ ] Alerts review

## Decision

- Result: pass / hold / rollback
- Reason:
- Next actions:
```

## Template 2: Failed Items List

```markdown
# Security Migration Failed Items

| ID | Severity | Item | Owner | ETA | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | open |  |
```

## Template 3: Rollback Record

```markdown
# Security Migration Rollback Record

- Incident ID:
- Trigger time:
- Trigger condition:
- Impact scope:
- Rollback start:
- Rollback end:
- Operator:
- Approver:

## Root Cause

- 

## Recovery Actions

- 

## Follow-up Remediation

- Owner:
- Deadline:
- Ticket:
```

## Template 4: Residual Risk List

```markdown
# Residual Risks

| Risk | Severity | Mitigation | Owner | Target Date | Review Date |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
```

