import { defineConfig } from 'vitest/config';

// Present so this package is a standalone vitest project: the root config
// globs packages/* and `npm test -w <pkg>` resolves this file instead of
// walking up to the root's project list.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
