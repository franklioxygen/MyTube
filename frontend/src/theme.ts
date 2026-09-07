import { createTheme } from "@mui/material/styles";
import {
  modeColors,
  shadow,
  type ThemeMode,
} from "./theme/colors";
import { createBreakpoints } from "@mui/system";
import type { AutomotiveBreakpointValues } from "./utils/automotiveDesktopLayout";

/**
 * In-car displays render inside a zoomed root, so their layout box is wider
 * than the viewport the media queries see. `breakpoints.values` cannot simply
 * be scaled to bridge that, because MUI reads it two different ways: as
 * media-query thresholds, which must follow the viewport, and as raw pixel
 * widths for `Container` and `Dialog`, which must follow the layout box.
 * Scaling both caps a maxWidth="lg" page at the car's 772px while its root has
 * ~1200 layout pixels to fill, wasting a third of the screen.
 *
 * So `values` keeps the stock numbers and only the query builders are swapped.
 * Every component asks for its media queries through up/down/between, and for
 * its pixel widths through values, which splits the two cleanly - no
 * per-component overrides, and nothing to keep in sync as MUI adds components.
 */
const withScaledMediaQueries = <T extends { breakpoints: object }>(
  theme: T,
  breakpointValues: AutomotiveBreakpointValues,
): T => {
  const scaled = createBreakpoints({ values: breakpointValues });

  return {
    ...theme,
    breakpoints: {
      ...theme.breakpoints,
      up: scaled.up,
      down: scaled.down,
      between: scaled.between,
      only: scaled.only,
      not: scaled.not,
    },
  };
};

const getTheme = (mode: ThemeMode, breakpointValues?: AutomotiveBreakpointValues) => {
  const colors = modeColors(mode);

  const theme = createTheme({
    palette: {
      mode,
      primary: {
        main: colors.primary,
      },
      secondary: {
        main: colors.secondary,
      },
      background: {
        default: colors.backgroundDefault,
        paper: colors.backgroundPaper,
      },
      text: {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
      },
    },
    typography: {
      // System-first stack: no external font CDN, works in China and offline
      fontFamily:
        'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
      h1: {
        fontWeight: 700,
      },
      h2: {
        fontWeight: 600,
      },
      h3: {
        fontWeight: 600,
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            textTransform: "none",
            fontWeight: 600,
            "&.MuiButton-loading": {
              textAlign: "center",
              color: "transparent",
              "& .MuiButton-loadingIndicator": {
                color: colors.textSecondary,
              },
            },
            "&.MuiButton-loadingPositionStart.MuiButton-loading": {
              "& .MuiButton-startIcon": {
                display: "none",
              },
              "& .MuiButton-loadingIndicator": {
                left: "50%",
                position: "absolute",
                transform: "translateX(-50%)",
              },
            },
            "&.MuiButton-loadingPositionEnd.MuiButton-loading": {
              "& .MuiButton-endIcon": {
                display: "none",
              },
              "& .MuiButton-loadingIndicator": {
                position: "absolute",
                right: "auto",
                left: "50%",
                transform: "translateX(-50%)",
              },
            },
          },
          containedPrimary: {
            boxShadow: mode === "dark" ? shadow.primaryGlow : "none",
            "&:hover": {
              boxShadow:
                mode === "dark" ? shadow.primaryGlowHover : shadow.black20,
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            backgroundImage: "none",
            backgroundColor: colors.cardBackground,
            backdropFilter: "blur(10px)",
            border: `1px solid ${colors.cardBorder}`,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: colors.appBarBackground,
            backdropFilter: "blur(10px)",
            borderBottom: `1px solid ${colors.appBarBorder}`,
            backgroundImage: "none",
            color: colors.textAppBar,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            backgroundColor: colors.backgroundPaper,
            border: colors.dialogBorder,
          },
        },
      },
    },
  });

  return breakpointValues ? withScaledMediaQueries(theme, breakpointValues) : theme;
};

export default getTheme;
