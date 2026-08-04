import { defineConfig } from '@playwright/test';

// Regression suite for UI/layout bugs that were reproduced and fixed via
// Playwright during interactive debugging sessions (hover-driven shifts,
// frozen-region border matching, resize-indicator clipping, etc.) — these
// don't need real Obsidian, only real DOM + the actual styles.css, so each
// fixture in test/e2e/fixtures/*.html is a minimal hand-built DOM that
// mirrors the exact classes/structure renderer.ts produces for that one
// scenario (see each fixture's own header comment for which source file/
// lines it mirrors — if that source changes shape, the fixture needs a
// matching update, since nothing here imports it directly).
//
// Deliberately NOT part of `npm run build` or `npm run test` (vitest) — run
// manually via `npm run test:e2e` before a release, or from the nightly-test
// GitHub Actions workflow.
export default defineConfig({
	testDir: './test/e2e',
	fullyParallel: true,
	reporter: 'list',
	use: {
		trace: 'retain-on-failure',
	},
});
