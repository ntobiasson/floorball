import { defineConfig, devices } from '@playwright/test';

const TABLE_NAME = 'sahlykanta-e2e';
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8001';

/**
 * Two API servers run side by side on different ports, one pinned to a Monday
 * and one to a Tuesday, so the game-day and not-a-game-day screens are both
 * exercised against the real API rather than a stub. Each web server proxies
 * /api to its own API.
 */
/**
 * Deliberately uncommon ports: 3000/3001 and 8000 are routinely occupied on a
 * developer machine, and a clash there silently points the tests at somebody
 * else's server.
 */
const API_MONDAY_PORT = process.env.E2E_API_MONDAY_PORT ?? '3400';
const API_TUESDAY_PORT = process.env.E2E_API_TUESDAY_PORT ?? '3401';
const WEB_MONDAY_PORT = process.env.E2E_WEB_MONDAY_PORT ?? '4473';
const WEB_TUESDAY_PORT = process.env.E2E_WEB_TUESDAY_PORT ?? '4474';

const apiEnv = {
  TABLE_NAME,
  DYNAMODB_ENDPOINT,
  AWS_REGION: 'eu-north-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
};

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: false,
  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    // The phone viewport layout A was designed for.
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${WEB_MONDAY_PORT}`,
  },
  projects: [
    {
      name: 'monday',
      testMatch: /smoke\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${WEB_MONDAY_PORT}` },
    },
    {
      name: 'tuesday',
      testMatch: /closed\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${WEB_TUESDAY_PORT}` },
    },
  ],
  globalSetup: './global-setup.ts',
  webServer: [
    {
      command: 'npm run serve -w @sahlykanta/api',
      port: Number(API_MONDAY_PORT),
      env: { ...apiEnv, PORT: API_MONDAY_PORT, FAKE_TODAY: '2026-10-19' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run serve -w @sahlykanta/api',
      port: Number(API_TUESDAY_PORT),
      env: { ...apiEnv, PORT: API_TUESDAY_PORT, FAKE_TODAY: '2026-10-20' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev -w @sahlykanta/web -- --port ${WEB_MONDAY_PORT} --strictPort`,
      port: Number(WEB_MONDAY_PORT),
      env: { API_ORIGIN: `http://127.0.0.1:${API_MONDAY_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -w @sahlykanta/web -- --port ${WEB_TUESDAY_PORT} --strictPort`,
      port: Number(WEB_TUESDAY_PORT),
      env: { API_ORIGIN: `http://127.0.0.1:${API_TUESDAY_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
