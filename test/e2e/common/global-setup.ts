// Playwright globalSetup — rebuilds real-bundle.generated.js fresh before
// every e2e run, same treatment as main.js in npm run build, so tests that
// exercise the REAL source (test-base.ts's `renderReal`) never run against
// a stale bundle.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function globalSetup(): void {
	execFileSync(process.execPath, [path.join(__dirname, 'build-bundle.mjs')], { stdio: 'inherit' });
}
