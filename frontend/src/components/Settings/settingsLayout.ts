/**
 * Shared widths for the settings page.
 *
 * Before this existed each section picked its own number, so a description
 * could run the full 1152px container while the input it described stopped at
 * 400px, and neighbouring selects landed on 240, 300, 400 and 420. Two
 * components had already grown private `SELECT_MAX_WIDTH` constants of their
 * own. Import these instead of writing a literal.
 */

/** Inputs, selects and other single-line controls. */
export const SETTINGS_CONTROL_MAX_WIDTH = 400;

/**
 * The readable column every settings section sits in. Applied once by
 * SettingsPage around the tab/section content, so prose, alerts and tables
 * share one measure without each component restating it.
 */
export const SETTINGS_SECTION_MAX_WIDTH = 760;
