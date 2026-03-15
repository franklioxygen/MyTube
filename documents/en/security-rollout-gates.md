# Security Rollout and Rollback Gates

## Rollout Batches

Recommended rollout progression:
- 10%
- 30%
- 60%
- 100%

Each batch must observe at least one full business peak cycle.

## Direct Full Cutover Exception

If operator intentionally skips canary and performs one-shot full migration:
- treat this as an explicit override decision
- require `--assert-clean` migration scan pass before cutover
- require a pre-approved rollback path and owner
- require decision log with reason and approval timestamp

## Mandatory Metrics

- login success rate
- download success rate
- `5xx` ratio
- permission denied event count
- rejected dangerous config count

## Hard Rollback Thresholds

Pause and rollback current batch if any condition is met:

- `5xx` ratio stays above baseline + 1% for 15 minutes.
- login success rate stays below baseline by more than 2% for 15 minutes.
- download failure rate stays above baseline by more than 5% for 30 minutes.
- admin login is blocked and cannot be recovered through controlled recovery flow.

Note:
- permission denied increases alone can be expected after strict cutover.
- combine security counters with business-availability metrics for rollback decisions.

## Batch Decision Record (Required)

For each batch, record:
- start time
- end time
- metric snapshot
- decision: continue / hold / rollback
- operator and approver

## Operational Rule

Do not promote or rollback based only on subjective observation.
Every decision must cite metric evidence and logged timestamps.
