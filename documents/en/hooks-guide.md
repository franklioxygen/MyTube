# Task Hooks Guide

MyTube lets you execute custom shell scripts at different stages of a download task. This is useful for post-processing, notifications, or external integrations.

## Available Hooks

| Hook Name | Trigger Point | Description |
| :--- | :--- | :--- |
| **Before Task Start** (`task_before_start`) | Before download begins | Runs right before the download starts. |
| **Task Success** (`task_success`) | After successful download | Runs after download/merge completes but **before** cloud upload (if enabled) or deletion. |
| **Task Failed** (`task_fail`) | On task failure | Runs when a download fails. |
| **Task Cancelled** (`task_cancel`) | On task cancellation | Runs when a user cancels a running task. |

Hook scripts are stored under `backend/data/hooks` by default.

## Environment Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `MYTUBE_TASK_ID` | Unique task ID | `335e98f0-15cb-46a4-846d-9d4351368923` |
| `MYTUBE_TASK_TITLE` | Video/task title | `Awesome Video Title` |
| `MYTUBE_SOURCE_URL` | Original video URL | `https://www.youtube.com/watch?v=...` |
| `MYTUBE_TASK_STATUS` | Current status | `start`, `success`, `fail`, `cancel` |
| `MYTUBE_VIDEO_PATH` | Absolute path to video file | `/app/uploads/videos/video.mp4` |
| `MYTUBE_THUMBNAIL_PATH` | Absolute path to thumbnail | `/app/uploads/images/video.jpg` |
| `MYTUBE_ERROR` | Error message (only for `task_fail`) | `Network timeout` |

## Configuration

1. Go to **Settings**.
2. Open **Advanced Settings**.
3. Find **Task Hooks**.
4. Upload `.sh` scripts for the desired events.
5. Delete or re-upload as needed.

Hooks are executed with `bash` and are made executable on upload.

## Viewing Logs

Any output from your script (stdout/stderr) is captured and logged by the backend.
- Standard output (`echo "..."`) is logged as `INFO`.
- Standard error (`>&2 echo "..."`) is logged as `WARN`.

Example:
```bash
echo "Hook started for task $MYTUBE_TASK_ID"
```
Will appear in server logs as:
`[INFO] [HookService] task_success stdout: Hook started for task 123...`

## Examples

### 1. Simple Logging
Log every successful download to a custom file.
**Hook:** `task_success`
```bash
#!/bin/bash
# Provide full path to your log file
echo "[$(date)] Downloaded: $MYTUBE_TASK_TITLE" >> /tmp/mytube_downloads.log
```

### 2. Send Notification (e.g., ntfy.sh)
Send a notification when a task fails.
**Hook:** `task_fail`
```bash
#!/bin/bash
curl -d "MyTube Download Failed: $MYTUBE_TASK_TITLE - $MYTUBE_ERROR" https://ntfy.sh/my_topic
```

### 3. File Post-Processing
Run a Python script to process the file.
**Hook:** `task_success`
```bash
#!/bin/bash
python3 /path/to/process_video.py "$MYTUBE_VIDEO_PATH"
```

## Security Warning

> [!WARNING]
> Hook commands run with the same permissions as the MyTube backend.
> - Be careful when using commands that modify or delete files.
> - Do not copy/paste scripts from untrusted sources.
> - Ensure your scripts handle errors gracefully.
