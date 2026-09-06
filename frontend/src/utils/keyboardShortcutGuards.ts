/**
 * Shared guards for the window-level keyboard shortcuts.
 *
 * Every global shortcut has to answer the same two questions before it acts:
 * is the viewer typing, and is an overlay currently owning the keyboard. The
 * player's shortcuts and the paginated grids used to answer them with two
 * different checks, each missing what the other caught - the player let a bare
 * `<div contenteditable>` through, the grids let a native `<select>` through.
 * Keeping one answer here means a new shortcut inherits both fixes.
 */

// `[contenteditable]` on its own also matches `contenteditable="false"`, which
// marks a region as explicitly *not* editable.
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

// Roles an overlay announces itself with, whether or not it traps focus:
// dialogs and alerts, and the menus and listboxes a select or sort control
// opens. Matching on the role rather than a component keeps this working for
// any overlay the app grows later.
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const asElement = (node: EventTarget | null): Element | null =>
  node instanceof Element ? node : null;

const isInside = (node: EventTarget | null, selector: string): boolean =>
  Boolean(asElement(node)?.closest(selector));

// A keydown aimed straight at `window` - a synthetic event, or one dispatched
// by a test - carries no element target, so the focused element is the only
// thing naming the field being typed into. Reading both also covers a handler
// that moved focus part-way through the dispatch.
const eventNodes = (event: KeyboardEvent): (EventTarget | null)[] => [
  event.target,
  document.activeElement,
];

/**
 * True while the keypress belongs to a form field or rich-text region, where a
 * shortcut would swallow a character the viewer meant to type.
 */
export const isTypingTarget = (event: KeyboardEvent): boolean =>
  eventNodes(event).some((node) => {
    const element = asElement(node);
    // `isContentEditable` is the DOM's own answer, so it covers the bare
    // attribute form and a focused child of an editable container - neither of
    // which an attribute comparison catches.
    if (element instanceof HTMLElement && element.isContentEditable) {
      return true;
    }
    return isInside(node, EDITABLE_SELECTOR);
  });

/**
 * True while a dialog or menu is open. Its keydowns still bubble out to the
 * window listeners, and arrow keys inside one belong to its own items - acting
 * on them anyway means closing the overlay reveals a state the viewer never
 * asked for. The open-modal check covers a keypress that lands outside the
 * dialog, such as after a click on the backdrop.
 */
export const isOverlayTarget = (event: KeyboardEvent): boolean => {
  if (document.querySelector('[aria-modal="true"]')) {
    return true;
  }
  return eventNodes(event).some((node) => isInside(node, OVERLAY_SELECTOR));
};
