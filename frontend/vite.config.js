import react from "@vitejs/plugin-react";
import { env } from "node:process";
import { defineConfig } from "vite";
import packageJson from "./package.json";

// Get API URL from environment variable or use default
// In dev mode, use relative path to leverage Vite proxy
// In production, use environment variable or default to localhost
// Note: In Vite, mode is 'development' by default, 'production' when building
const isDev = !env.NODE_ENV || env.NODE_ENV === "development";
const API_URL =
  env.VITE_API_URL || (isDev ? "/api" : "http://localhost:5551/api");

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Enable CSS code splitting for better performance
    cssCodeSplit: true,
    // Use esbuild for faster CSS minification
    cssMinify: "esbuild",
    rollupOptions: {
      output: {
        // Use Vite's automatic code splitting strategy to avoid circular dependency issues
        // Vite automatically handles chunk splitting intelligently based on imports
        // This prevents "Cannot access before initialization" errors from circular dependencies
        manualChunks: undefined,
      },
    },
  },
  server: {
    host: "0.0.0.0", // Listen on all network interfaces to allow LAN access
    port: 5556,
    watch: {
      usePolling: true,
      interval: 2000,
      ignored: ["/node_modules/"],
    },
    // Use environment variable for backend URL, fallback to localhost
    // In dev mode, proxy runs on server side, so localhost works even when accessed via LAN IP
    proxy: {
      "/api": {
        target: env.VITE_BACKEND_URL || "http://127.0.0.1:5551",
        changeOrigin: true,
        secure: false,
      },
      "/cloud": {
        target: env.VITE_BACKEND_URL || "http://127.0.0.1:5551",
        changeOrigin: true,
        secure: false,
      },
      "/images": {
        target: env.VITE_BACKEND_URL || "http://127.0.0.1:5551",
        changeOrigin: true,
        secure: false,
      },
      "/videos": {
        target: env.VITE_BACKEND_URL || "http://127.0.0.1:5551",
        changeOrigin: true,
        secure: false,
      },
      "/subtitles": {
        target: env.VITE_BACKEND_URL || "http://127.0.0.1:5551",
        changeOrigin: true,
        secure: false,
      },
      "/avatars": {
        target: env.VITE_BACKEND_URL || "http://127.0.0.1:5551",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
    // Only define VITE_API_URL if explicitly set, otherwise let runtime code handle it
    // This allows getApiUrl() to work correctly in both dev and production
    ...(env.VITE_API_URL
      ? { "import.meta.env.VITE_API_URL": JSON.stringify(env.VITE_API_URL) }
      : {}),
    "import.meta.env.VITE_BUILD_DATE": JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    env: {
      VITE_API_URL: "http://localhost:5551/api",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.config.js",
        "**/*.config.ts",
        "**/__tests__/**",
        "src/vite-env.d.ts", // Types
        "src/types.ts", // Types
        "src/theme.ts", // Theme config
        "src/setupTests.ts", // Test setup
        "src/version.ts", // Version constant
      ],
    },
  },
});
