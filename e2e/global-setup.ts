import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Seeds DynamoDB Local once, before any server starts. */
export default function globalSetup(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync('npx', ['tsx', path.join(here, 'seed.ts')], {
    stdio: 'inherit',
    cwd: path.join(here, '..'),
  });
}
