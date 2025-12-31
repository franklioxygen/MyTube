#!/bin/bash

# Sample Hook Script for MyTube
# Usage: Configure this script in MyTube Settings -> Advanced -> Task Hooks
# Example: Set "Task Success" to: bash /path/to/documents/sample_hook.sh

# Output log file
LOG_FILE="/tmp/mytube_hook_sample.log"

echo "==================================================" >> "$LOG_FILE"
echo "MyTube Hook Triggered at $(date)" >> "$LOG_FILE"
echo "==================================================" >> "$LOG_FILE"

# Log Basic Task Information
echo "Task ID:      $MYTUBE_TASK_ID" >> "$LOG_FILE"
echo "Task Title:   $MYTUBE_TASK_TITLE" >> "$LOG_FILE"
echo "Task Status:  $MYTUBE_TASK_STATUS" >> "$LOG_FILE"
echo "Source URL:   $MYTUBE_SOURCE_URL" >> "$LOG_FILE"

# Handle specific states
if [ "$MYTUBE_TASK_STATUS" == "success" ]; then
    echo "✅ Download Completed Successfully" >> "$LOG_FILE"
    echo "   Video Path:     $MYTUBE_VIDEO_PATH" >> "$LOG_FILE"
    echo "   Thumbnail Path: $MYTUBE_THUMBNAIL_PATH" >> "$LOG_FILE"

    # Example: Check file existence and size
    if [ -f "$MYTUBE_VIDEO_PATH" ]; then
        SIZE=$(ls -lh "$MYTUBE_VIDEO_PATH" | awk '{print $5}')
        echo "   File Size:      $SIZE" >> "$LOG_FILE"
        echo "   File exists and is ready for post-processing." >> "$LOG_FILE"
    else
        echo "   ⚠️ Warning: Video file not found at path." >> "$LOG_FILE"
    fi

elif [ "$MYTUBE_TASK_STATUS" == "fail" ]; then
    echo "❌ Download Failed" >> "$LOG_FILE"
    echo "   Error: $MYTUBE_ERROR" >> "$LOG_FILE"

elif [ "$MYTUBE_TASK_STATUS" == "cancelled" ]; then
    echo "⚠️ Download Cancelled by User" >> "$LOG_FILE"
fi

echo "--------------------------------------------------" >> "$LOG_FILE"
