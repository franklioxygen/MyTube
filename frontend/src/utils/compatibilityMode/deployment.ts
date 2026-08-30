/**
 * Deployment shape for compatibility mode.
 *
 * On a general browser the mode is an opt-in preference and the standard
 * `<video>` player is always available to fall back to. On the in-car
 * entertainment display it is the only playback path — that screen does not
 * render a media element at all — so the mode is forced on, the toggle is
 * withdrawn, and failure has to be reported as failure rather than as an
 * invitation to switch players.
 *
 * Set `VITE_FORCE_COMPATIBILITY_MODE=true` in the car build's environment.
 */

const truthy = new Set(["true", "1", "yes", "on"]);

export function isCompatibilityModeForced(): boolean {
  const flag = import.meta.env.VITE_FORCE_COMPATIBILITY_MODE;
  return typeof flag === "string" && truthy.has(flag.trim().toLowerCase());
}
