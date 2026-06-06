/**
 * Centralized color tokens for the MyTube frontend.
 * All raw color values live here — import from this module instead of hardcoding hex/rgba.
 */

export type ThemeMode = "light" | "dark";

/** Core brand palette (also used in logo.svg / favicon.svg gradients). */
export const brand = {
  primaryDark: "#00e5ff",
  primaryLight: "#00727d",
  secondary: "#651fff",
  accentPink: "#FF7eb3",
  accentBlue: "#00bfff",
  accentRed: "#ff3333",
  metaTheme: "#ff3e3e",
} as const;

/** Neutral grayscale ramp. */
export const neutral = {
  black: "#000000",
  white: "#ffffff",
  grey950: "#0f0f0f",
  grey900: "#121212",
  grey850: "#1a1a1a",
  grey800: "#1e1e1e",
  grey750: "#212121",
  grey700: "#2a2a2a",
  grey600: "#333333",
  grey550: "#444444",
  grey500: "#8f8f8f",
  grey400: "#b3b3b3",
  grey300: "#ececec",
  grey200: "#f5f5f5",
  slate900: "#0f172a",
  slate50: "#f8fafc",
} as const;

/** Third-party platform brand colors. */
export const platform = {
  youtube: "#ff0000",
  bilibili: "#23ade5",
} as const;

/** Semantic status colors. */
export const status = {
  success: "#4caf50",
  error: "#d32f2f",
} as const;

/** Semi-transparent overlays used on thumbnails, video controls, badges, etc. */
export const overlay = {
  black35: "rgba(0, 0, 0, 0.35)",
  black45: "rgba(0, 0, 0, 0.45)",
  black50: "rgba(0, 0, 0, 0.5)",
  black55: "rgba(0, 0, 0, 0.55)",
  black60: "rgba(0, 0, 0, 0.6)",
  black70: "rgba(0, 0, 0, 0.7)",
  black75: "rgba(0, 0, 0, 0.75)",
  black80: "rgba(0, 0, 0, 0.8)",
  black90: "rgba(0, 0, 0, 0.9)",
  white01: "rgba(255, 255, 255, 0.01)",
  white02: "rgba(255, 255, 255, 0.02)",
  white05: "rgba(255, 255, 255, 0.05)",
  white08: "rgba(255, 255, 255, 0.08)",
  white10: "rgba(255, 255, 255, 0.1)",
  white14: "rgba(255, 255, 255, 0.14)",
  white32: "rgba(255, 255, 255, 0.32)",
  white70: "rgba(255, 255, 255, 0.7)",
  white80: "rgba(255, 255, 255, 0.8)",
  white90: "rgba(255, 255, 255, 0.9)",
  white92: "rgba(255, 255, 255, 0.92)",
  black05: "rgba(0, 0, 0, 0.05)",
  black10: "rgba(0, 0, 0, 0.1)",
  black20: "rgba(0, 0, 0, 0.2)",
  black32: "rgba(0, 0, 0, 0.32)",
  slate08: "rgba(15, 23, 42, 0.08)",
  textLightSecondary: "rgba(18, 18, 18, 0.7)",
  surfaceDark60: "rgba(30, 30, 30, 0.6)",
  primaryCyan50: "rgba(0, 229, 255, 0.5)",
  primaryCyan70: "rgba(0, 229, 255, 0.7)",
  error90: "rgba(211, 47, 47, 0.9)",
  highlightYellow: "rgba(255, 235, 59, 0.3)",
  muiBlue70: "rgba(25, 118, 210, 0.7)",
  muiBlue00: "rgba(25, 118, 210, 0)",
  sidebarTrack: "rgba(0, 0, 0, 0.1)",
  sidebarThumb: "rgba(0, 0, 0, 0.2)",
} as const;

/** CSS mask gradients (opaque = visible, transparent = hidden in mask alpha). */
export const mask = {
  transparent: "transparent",
  fadeRight: `linear-gradient(to right, ${neutral.black} 90%, transparent 100%)`,
} as const;

/** Gradient backgrounds. */
export const gradient = {
  controlsFullscreen: `linear-gradient(to top, ${overlay.black75}, ${overlay.black35} 45%, rgba(0, 0, 0, 0))`,
  statsCardDark: `linear-gradient(180deg, ${overlay.white02} 0%, ${overlay.white01} 100%)`,
  statsCardLight: `linear-gradient(180deg, ${overlay.white90} 0%, rgba(248, 250, 252, 0.95) 100%)`,
} as const;

/** Box-shadow and filter tokens. */
export const shadow = {
  primaryGlow: `0 0 10px ${overlay.primaryCyan50}`,
  primaryGlowHover: `0 0 20px ${overlay.primaryCyan70}`,
  black20: `0 2px 4px ${overlay.black20}`,
  dropShadow32: `drop-shadow(0px 2px 8px ${overlay.black32})`,
  thumbnail: "0 2px 6px rgba(0, 0, 0, 0.3)",
  successGlow: `0 0 4px ${status.success}`,
  focusRing: `0 0 0 2px ${overlay.black45}`,
  buttonGlow0: `0 0 0 0 ${overlay.muiBlue70}`,
  buttonGlow10: `0 0 0 10px ${overlay.muiBlue00}`,
} as const;

/** Scrollbar colors per theme mode. */
export const scrollbar = {
  dark: {
    track: neutral.grey800,
    thumb: neutral.grey600,
    thumbHover: neutral.grey550,
  },
  light: {
    track: neutral.grey300,
    thumb: neutral.grey400,
    thumbHover: neutral.grey500,
  },
} as const;

/** Mode-aware semantic color resolver for components and MUI theme. */
export const modeColors = (mode: ThemeMode) => ({
  primary: mode === "dark" ? brand.primaryDark : brand.primaryLight,
  backgroundDefault: mode === "dark" ? neutral.grey950 : neutral.grey200,
  backgroundPaper: mode === "dark" ? neutral.grey800 : neutral.white,
  backgroundElevated: mode === "dark" ? neutral.grey850 : neutral.white,
  backgroundSurface: mode === "dark" ? neutral.grey700 : neutral.white,
  textPrimary: mode === "dark" ? neutral.white : neutral.grey750,
  textSecondary:
    mode === "dark" ? overlay.white70 : overlay.textLightSecondary,
  textAppBar: mode === "dark" ? neutral.white : neutral.grey900,
  cardBackground: mode === "dark" ? overlay.surfaceDark60 : neutral.white,
  cardBorder: mode === "dark" ? overlay.white10 : overlay.black10,
  appBarBackground: mode === "dark" ? overlay.black80 : overlay.white80,
  appBarBorder: mode === "dark" ? overlay.white05 : overlay.black05,
  dialogBorder: mode === "dark" ? overlay.white10 : "none",
  rankingDivider: mode === "dark" ? overlay.white08 : overlay.slate08,
});
