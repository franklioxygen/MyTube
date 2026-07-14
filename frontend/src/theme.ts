import { createTheme } from "@mui/material/styles";
import {
  modeColors,
  shadow,
  type ThemeMode,
} from "./theme/colors";

const getTheme = (mode: ThemeMode) => {
  const colors = modeColors(mode);

  return createTheme({
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
};

export default getTheme;
