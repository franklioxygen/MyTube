# Telegram Direct Download

## Goal

Allow MyTube to accept plain Telegram messages that contain video links and queue them as download tasks, without requiring trigger keywords such as `mytube:` or `/download`.

## User Flow

1. Configure Telegram Bot Token and Chat ID in MyTube settings.
2. Enable Telegram notifications.
3. Enable Telegram link downloads.
4. Send one or more supported links to the configured bot/chat.
5. MyTube validates the sender chat ID, extracts links, queues downloads, and replies in Telegram with the queue result.

## Security Rules

- Only the configured `telegramChatId` may submit downloads.
- Bot token and chat ID continue to live in MyTube settings, not in source code.
- Messages without links are ignored.
- Download requests reuse the existing MyTube download path, including URL validation, duplicate checks, and queue handling.

## Implementation Notes

- Use Telegram `getUpdates` polling so self-hosted deployments do not need a public webhook URL.
- Avoid sharing the same bot token with another webhook or `getUpdates` consumer, because Telegram delivers each update to only one consumer.
- Store the last processed update ID in memory per server process to avoid reprocessing messages during normal runtime.
- Use the existing Bot Token and Chat ID settings.
- Add a separate `telegramDownloadEnabled` setting so completion notifications and inbound download commands can be controlled independently.

## Test Plan

- Unit test link extraction and chat authorization.
- Unit test successful queue flow and Telegram reply flow.
- Unit test ignored messages when disabled, unauthorized, or link-free.
- Run backend tests for the new Telegram direct-download service and existing Telegram notification service.
- Run TypeScript checks/build for backend and frontend after implementation.
