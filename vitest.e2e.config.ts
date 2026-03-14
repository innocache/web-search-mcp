import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['tests/e2e/globalSetup.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
  },
});
