import { overlay, scrollbar, shadow, type ThemeMode } from "./colors";

/** CSS custom property names synced with index.css. */
export const cssVars = {
  scrollbarTrack: "--scrollbar-track",
  scrollbarThumb: "--scrollbar-thumb",
  scrollbarThumbHover: "--scrollbar-thumb-hover",
  highlightYellow: "--color-highlight-yellow",
  shadowButtonGlow0: "--shadow-button-glow-0",
  shadowButtonGlow10: "--shadow-button-glow-10",
} as const;

/** Apply theme-aware CSS custom properties to the document root. */
export const applyThemeCssVariables = (mode: ThemeMode): void => {
  const root = document.documentElement;
  const sb = scrollbar[mode];

  root.style.setProperty(cssVars.scrollbarTrack, sb.track);
  root.style.setProperty(cssVars.scrollbarThumb, sb.thumb);
  root.style.setProperty(cssVars.scrollbarThumbHover, sb.thumbHover);
  root.style.setProperty(cssVars.highlightYellow, overlay.highlightYellow);
  root.style.setProperty(cssVars.shadowButtonGlow0, shadow.buttonGlow0);
  root.style.setProperty(cssVars.shadowButtonGlow10, shadow.buttonGlow10);
};
