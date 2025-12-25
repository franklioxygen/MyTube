import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageJson from "./package.json";

// Get API URL from environment variable or use default
const API_URL = process.env.VITE_API_URL || "http://localhost:5551/api";

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
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    env: {
      VITE_API_URL: "http://localhost:5551/api",
    },
  },
});
