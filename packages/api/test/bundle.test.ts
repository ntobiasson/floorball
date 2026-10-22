import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from 'esbuild';

const run = promisify(execFile);

/**
 * The Lambda does not run the TypeScript these tests run. It runs an esbuild
 * ESM bundle, and some packages behave differently once bundled — `ulid`
 * detected its random source at module load through a CommonJS `require`
 * that does not survive the conversion, so every invocation died at cold
 * start with "secure crypto unusable" while every local test passed.
 *
 * So: bundle the handler exactly as the CDK does, then import it **in a
 * separate node process**. The separate process matters — vitest's module
 * runner supplies a `require` shim that plain ESM on Lambda does not, so
 * importing the bundle from inside a test passes even when the same bundle
 * is dead on arrival in production.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
let outDir: string;

beforeAll(() => {
  // Inside the package: Vite refuses to resolve a dynamic import pointing
  // outside the project root.
  outDir = path.join(here, '..', '.bundle-test');
  mkdirSync(outDir, { recursive: true });
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

test('the handler can be loaded from an esbuild bundle, as Lambda loads it', async () => {
  const outfile = path.join(outDir, 'index.mjs');

  await build({
    entryPoints: [path.join(here, '../src/handler.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    // Mirrors the NodejsFunction settings in packages/infra.
    format: 'esm',
    target: 'node24',
    // CDK leaves the AWS SDK to the runtime for Node 18 and above.
    external: ['@aws-sdk/*'],
  });

  // Loading is the whole test: the production failure happened at module
  // evaluation, before any request was handled.
  const probe = [
    `const m = await import(${JSON.stringify(pathToFileURL(outfile).href)});`,
    "if (typeof m.handler !== 'function') { throw new Error('no handler export'); }",
    "console.log('loaded');",
  ].join('\n');

  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', probe], {
    env: {
      ...process.env,
      TABLE_NAME: 'bundle-test-table',
      // The handler refuses to start without these, exactly as a misconfigured
      // deployment should. Neither is read until a request arrives.
      TURNSTILE_SECRET_ARN:
        'arn:aws:secretsmanager:eu-north-1:000000000000:secret:sahlykanta/turnstile-AbCdEf',
      TURNSTILE_HOSTNAMES: 'd111111abcdef8.cloudfront.net',
      AWS_REGION: process.env.AWS_REGION ?? 'eu-north-1',
    },
  });

  expect(stdout.trim()).toBe('loaded');
}, 60_000);
