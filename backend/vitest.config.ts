import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.ts',
        '**/__tests__/**',
        'scripts/**',
        'src/version.ts',
        'src/services/downloaders/**',
        'src/services/migrationService.ts',
        'src/server.ts', // Entry point
        'src/db/**', // Database config
        'src/scripts/**', // Scripts
        'src/routes/**', // Route configuration files
        'src/config/**', // Config files
        'src/types/**', // Type definitions
        'bgutil-ytdlp-pot-provider/**',
      ],
    },
  },
});
