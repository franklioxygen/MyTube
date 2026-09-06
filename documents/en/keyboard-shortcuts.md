# Keyboard Shortcuts

The video player answers the same keys YouTube does, so muscle memory carries over. Shortcuts work whenever the player page has focus — you do not need to click the video first.

## Playback

| Key | Action |
|---|---|
| `Space` or `K` | Play / pause |
| `←` / `→` | Seek back / forward by the short step |
| `J` / `L` | Seek back / forward by the medium step |
| `0`–`9` | Jump to 0%–90% of the video |
| `Home` / `End` | Jump to the start / end |
| `,` / `.` | Step one frame back / forward (pauses first) |
| `<` / `>` | Slower / faster playback |

The seek steps are your own settings, not fixed values: **Settings → Video Player Defaults** sets the *Short interval* and *Medium interval* (10s and 60s by default). Frame stepping assumes 30fps — HTML video exposes no frame rate, so the step is approximate.

Speed moves through the same ladder the speed menu offers (0.5, 0.75, 1, 1.25, 1.5, 2, 3) rather than a free multiplier, so the keyboard and the menu never disagree.

## Audio

| Key | Action |
|---|---|
| `↑` / `↓` | Volume up / down by 5% |
| `M` | Mute / unmute |

Unmuting restores the volume you had before, not full volume.

## Display

| Key | Action |
|---|---|
| `F` | Fullscreen on / off |
| `T` | Cinema mode on / off |
| `C` | Subtitles on / off |

`T` leaves fullscreen on the way into cinema mode — they are two ways to make the player big, and being in both leaves nothing to switch back with.

`C` has no menu to choose from, so it turns the whole set off, or turns on the first available track, preferring a file subtitle and falling back to a live translated one.

## Up Next

| Key | Action |
|---|---|
| `Shift` + `N` | Play the next video |
| `Shift` + `P` | Play the previous video |

`Shift+N` goes to the top item in the Up Next sidebar — the same video autoplay would advance to.

`Shift+P` only has somewhere to go when the video is being played from a collection or a playback queue, matching YouTube, where "previous" is a playlist move. On a standalone video the key does nothing.

## When shortcuts do not fire

Shortcuts stay out of the way in three cases:

- **You are typing.** Any input, textarea, select, or rich-text region has the keyboard, including a field inside the page's own dialogs.
- **A dialog or menu is open.** The subtitle, speed, and collection menus own the keyboard while they are open.
- **A modifier is held.** Anything with `Ctrl`, `Cmd`, or `Alt` belongs to the browser — `Cmd+←` stays Back, `Ctrl+F` stays Find. `Shift` is the exception, since the shortcuts above use it.

Held keys do not repeat: each shortcut fires once per press.

## Browsing

| Key | Action |
|---|---|
| `←` / `→` | Previous / next page in a paginated grid |

This works on the home page and collection pages, under the same rules — not while typing, and not while a dialog or menu is open.

## Not covered

**D Mode** (the compatibility player used for sources the standard player cannot handle) has its own controls and does not take these shortcuts.
