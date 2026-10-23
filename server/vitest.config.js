import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      MAIL_PROVIDER: 'local',
      LOCAL_SMTP_PORT: '0',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.js'], testTimeout: 30000 } },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.js'], globalSetup: ['tests/helpers/mongoGlobalSetup.js'], testTimeout: 60000, hookTimeout: 120000 },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.js'],
          globalSetup: ['tests/helpers/mongoGlobalSetup.js'],
          testTimeout: 180000,
          hookTimeout: 180000,
          fileParallelism: false,
          env: { WEBAUTHN_ORIGIN: 'http://localhost:4555', CLIENT_ORIGINS: 'http://localhost:4555', SERVE_CLIENT: 'true' },
        },
      },
    ],
  },
});
