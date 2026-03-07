# Task Hooks Guide

MyTube supports declarative task hooks.  
Hooks are configured as JSON action definitions, not shell scripts.

## Available Hook Events

| Hook Name | Trigger Point | Description |
| :--- | :--- | :--- |
| `task_before_start` | Before download begins | Runs before download starts. |
| `task_success` | After successful download | Runs after download/merge completes, before cloud upload/delete. |
| `task_fail` | On task failure | Runs when a download fails. |
| `task_cancel` | On task cancellation | Runs when a task is cancelled. |

Hook definitions are stored under `backend/data/hooks/*.json`.

## Execution Model

- Event -> queue -> restricted executor.
- Hooks are processed sequentially.
- Arbitrary shell commands are not supported.

## Execution Modes

- `HOOK_EXECUTION_MODE=inline`:
  - Backend process enqueues and executes hook actions locally.
  - Useful for local development or simple single-process setups.
- `HOOK_EXECUTION_MODE=worker`:
  - Backend process only enqueues jobs to `hook_worker_jobs`.
  - A separate `hook-worker` process/container polls and executes actions.
  - Recommended for production isolation.

For worker mode, run the worker with hardened container settings:
- non-root user
- read-only root filesystem with dedicated writable data mount
- `no-new-privileges`
- `cap_drop: [ALL]`
- Docker default seccomp policy and `apparmor=docker-default`

## Supported Action Types

### `notify_webhook`

Send an HTTP webhook request.

```json
{
  "version": 1,
  "actions": [
    {
      "type": "notify_webhook",
      "url": "https://example.com/mytube-hook",
      "method": "POST",
      "timeoutMs": 5000,
      "headers": {
        "X-App": "MyTube"
      },
      "bodyTemplate": "Task {{taskTitle}} ({{taskId}}) -> {{status}}"
    }
  ]
}
```

Supported methods: `POST`, `PUT`, `PATCH`.

## Template Variables

`bodyTemplate` supports:

- `{{eventName}}`
- `{{taskId}}`
- `{{taskTitle}}`
- `{{sourceUrl}}`
- `{{status}}`
- `{{videoPath}}`
- `{{thumbnailPath}}`
- `{{error}}`

If `bodyTemplate` is omitted, MyTube sends a JSON payload with these fields.

## Configuration Steps

1. Go to **Settings**.
2. Open **Advanced Settings**.
3. Find **Task Hooks**.
4. Upload a `.json` hook definition for the event.
5. Delete/re-upload when needed.

## Notes

- Legacy `.sh` hook scripts are ignored by the executor.
- Invalid or unsupported action definitions are rejected on upload.
