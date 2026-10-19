import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One project per workspace package; each may add its own config (web
    // needs jsdom and the React plugin).
    projects: ['packages/*'],
  },
});
