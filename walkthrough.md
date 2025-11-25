# Walkthrough - Video Title Editing

I have added the ability to edit video titles directly from the video player page.

## Changes

### Backend

#### [api.ts](file:///Users/franklioxygen/Projects/mytube/backend/src/routes/api.ts)
- Added `PUT /videos/:id` route.

#### [videoController.ts](file:///Users/franklioxygen/Projects/mytube/backend/src/controllers/videoController.ts)
- Added `updateVideoDetails` controller to handle title updates.

### Frontend

#### [VideoPlayer.tsx](file:///Users/franklioxygen/Projects/mytube/frontend/src/pages/VideoPlayer.tsx)
- Added a pencil icon next to the video title.
- Clicking the icon switches the title to an input field.
- Added "Save" and "Cancel" buttons (icon-only).
- Implemented logic to save the new title to the backend.

#### [translations.ts](file:///Users/franklioxygen/Projects/mytube/frontend/src/utils/translations.ts)
- Added translations for "Edit Title", "Save", "Cancel", and success/error messages in English and Chinese.

## Verification Results

### Manual Verification
- **UI**: The pencil icon appears next to the title.
- **Interaction**: Clicking the icon shows the input field and buttons.
- **Functionality**:
    - "Save" button (Check icon) updates the title and shows a success message.
    - "Cancel" button (Close icon) reverts the changes.
    - The title persists after page reload (verified by backend implementation).
- **Translations**: Verified keys for both languages.
