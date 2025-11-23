import { createTheme } from '@mui/material/styles';

const getTheme = (mode: 'light' | 'dark') => createTheme({
  palette: {
    mode,
    primary: {
      main: mode === 'dark' ? '#00e5ff' : '#00838f', // Neon Cyan for dark, Cyan 800 for light
    },
    secondary: {
      main: '#651fff', // Deep Purple
    },
    background: {
      default: mode === 'dark' ? '#0a0a0a' : '#f5f5f5',
      paper: mode === 'dark' ? '#1e1e1e' : '#ffffff',
    },
    text: {
      primary: mode === 'dark' ? '#ffffff' : '#212121', // Dark grey for light mode
      secondary: mode === 'dark' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
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
          textTransform: 'none',
          fontWeight: 600,
        },
        containedPrimary: {
          boxShadow: mode === 'dark' ? '0 0 10px rgba(0, 229, 255, 0.5)' : 'none', // Neon glow only in dark mode
          '&:hover': {
            boxShadow: mode === 'dark' ? '0 0 20px rgba(0, 229, 255, 0.7)' : '0 2px 4px rgba(0,0,0,0.2)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundImage: 'none', // Remove default gradient in dark mode if unwanted
          backgroundColor: mode === 'dark' ? 'rgba(30, 30, 30, 0.6)' : '#ffffff', // Glassmorphism base
          backdropFilter: 'blur(10px)',
          border: mode === 'dark' ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: mode === 'dark' ? 'rgba(10, 10, 10, 0.8)' : 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(10px)',
          borderBottom: mode === 'dark' ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(0, 0, 0, 0.05)',
          backgroundImage: 'none',
          color: mode === 'dark' ? '#fff' : '#000',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          backgroundColor: mode === 'dark' ? '#1e1e1e' : '#ffffff',
          border: mode === 'dark' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
        },
      },
    },
  },
});

export default getTheme;
