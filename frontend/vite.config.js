import react from "@vitejs/plugin-react";
import { env } from "node:process";
import { defineConfig } from "vite";
import packageJson from "./package.json";

// Get API URL from environment variable or use default
const API_URL = env.VITE_API_URL || "http://localhost:5551/api";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5556,
    watch: {
      usePolling: true,
      interval: 2000,
      ignored: ["/node_modules/"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:5551",
        changeOrigin: true,
        secure: false,
      },
      "/cloud": {
        target: "http://localhost:5551",
        changeOrigin: true,
        secure: false,
      },
      "/images": {
        target: "http://localhost:5551",
        changeOrigin: true,
        secure: false,
      },
      "/videos": {
        target: "http://localhost:5551",
        changeOrigin: true,
        secure: false,
      },
      "/subtitles": {
        target: "http://localhost:5551",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
    "import.meta.env.VITE_API_URL": JSON.stringify(API_URL),
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
