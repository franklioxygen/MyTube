/**
 * Viewport units do not follow the `zoom` an in-car display applies to the app
 * root, so a `100vh` box inside it lays out at 100vh and then renders at
 * 100vh * zoom - about two thirds of the screen on the measured car. Dividing
 * the viewport term by the factor the layout publishes puts it back.
 *
 * The `1` fallback makes these identical to plain viewport units in every
 * ordinary browser, where the variable is never set.
 *
 * Only for content inside #root. Anything MUI portals to <body> - Menu and
 * Popover paper, Dialog - sits outside the zoom and must keep plain units.
 * Note this includes fullscreen elements: the top layer does not escape an
 * ancestor's zoom, so a fullscreen `100vw` box is scaled down too.
 *
 * Only the viewport term is divided; px terms are already in the same
 * coordinate space as the element, so `calc(100vh - 180px)` becomes
 * `calc(viewportHeight() - 180px)`, not `calc((100vh - 180px) / zoom)`.
 */
const compensated = (unit: 'vh' | 'vw', percent: number) => (
    `calc(${percent}${unit} / var(--automotive-zoom, 1))`
);

/** Viewport height that survives the in-car zoom. Defaults to the full height. */
export const viewportHeight = (percent = 100) => compensated('vh', percent);

/** Viewport width that survives the in-car zoom. Defaults to the full width. */
export const viewportWidth = (percent = 100) => compensated('vw', percent);

/**
 * Cancels the in-car zoom for a subtree, restoring the viewport's own
 * coordinate system inside it.
 *
 * Fullscreen elements need this. They sit under #root and so inherit the zoom,
 * and SpeedControl and SubtitleControl deliberately portal their menus into
 * `document.fullscreenElement` so the menus are visible above the video. MUI
 * positions those from getBoundingClientRect - viewport coordinates - which a
 * zoomed ancestor then scales a second time, landing them far from their
 * buttons. Cancelling the zoom puts the two back in the same space.
 *
 * Inside this subtree, plain viewport units are correct again: use `100vh`,
 * not viewportHeight(). Resolves to `1` in every ordinary browser, where the
 * variable is unset, which is the CSS default and therefore a no-op.
 */
export const cancelAutomotiveZoom = 'calc(1 / var(--automotive-zoom, 1))';

