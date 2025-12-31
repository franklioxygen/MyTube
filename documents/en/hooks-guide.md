# Task Hooks Guide

MyTube allows you to execute custom shell scripts at various stages of a download task's lifecycle. This feature is powerful for integrating MyTube with other systems, performing post-processing on downloaded files, or sending notifications.

## available Hooks

You can configure commands for the following events:

| Hook Name | Trigger Point | Description |
| :--- | :--- | :--- |
| **Before Task Start** (`task_before_start`) | Before download begins | Executed immediately before the download process starts. Useful for setup or validation. |
| **Task Success** (`task_success`) | After successful download | Executed after the file is successfully downloaded / merged, but **before** it is uploaded to cloud storage (if enabled) or deleted. This is the ideal place for file processing. |
| **Task Failed** (`task_fail`) | On task failure | Executed if the download fails for any reason. |
| **Task Cancelled** (`task_cancel`) | On task cancellation | Executed when a user manually cancels a running task. |

## Environment Variables

When a hook command is executed, the following environment variables are injected into the shell environment, providing context about the task:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `MYTUBE_TASK_ID` | The unique identifier of the task | `335e98f0-15cb-46a4-846d-9d4351368923` |
| `MYTUBE_TASK_TITLE` | The title of the video/task | `Awesome Video Title` |
| `MYTUBE_SOURCE_URL` | The original URL of the video | `https://www.youtube.com/watch?v=...` |
| `MYTUBE_TASK_STATUS` | The current status of the task | `success`, `fail`, `cancelled` |
| `MYTUBE_VIDEO_PATH` | Absolute path to the downloaded video file | `/app/downloads/video.mp4` |
| `MYTUBE_THUMBNAIL_PATH` | Absolute path to the thumbnail file | `/app/downloads/video.jpg` |
| `MYTUBE_ERROR` | Error message (only for `task_fail`) | `Network timeout` |

## Configuration

You can configure hooks in the web interface:
1. Go to **Settings**.
2. Scroll down to **Advanced Settings**.
3. Find the **Task Hooks** section.
4. Upload your `.sh` scripts for the desired events.
5. You can Delete or Re-upload scripts as needed.

## Viewing Logs

Any output from your script (stdout/stderr) will be captured and logged to the MyTube server console.
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
Run a python script to process the file.
**Hook:** `task_success`
```bash
#!/bin/bash
python3 /path/to/process_video.py "$MYTUBE_VIDEO_PATH"
```

## Security Warning

> [!WARNING]
> Hook commands are executed with the same permissions as the MyTube backend server.
> - Be careful when using commands that modify or delete files.
> - Do not copy-paste scripts from untrusted sources.
> - Ensure your scripts handle errors gracefully.
