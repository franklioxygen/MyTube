import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageJson from './package.json';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5556,
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
