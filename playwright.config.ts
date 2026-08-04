import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Regression suite for UI/layout bugs reproduced and fixed via Playwright
// during interactive debugging sessions — organized one issue per folder
// under test/e2e/issues/<name>/, with shared infrastructure in
// test/e2e/common/ (see that directory's own files for what each piece
// does). Two ways a test gets real DOM/CSS to assert against:
//   - A hand-built fixture (<issue>/<issue>.html) that mirrors the exact
//     classes/structure renderer.ts produces for one specific scenario,
//     with the relevant algorithm hand-ported into an inline <script> —
//     used when the scenario is narrow enough that a faithful hand-port is
//     low-risk (see each fixture's own header comment for exactly what it
//     mirrors, and note the port needs a matching update if that source
//     changes shape — nothing here imports it directly).
//   - test-base.ts's `renderReal` fixture, which runs the REAL bundled
//     source (parser.ts/renderFreeze.ts/renderGridHelpers.ts/
//     renderCellStyle.ts — see real-bundle-entry.ts) against a real,
//     complete model — used for anything involving merge/style resolution
//     interacting with freeze, where a hand-port already missed a real bug
//     once (see freeze-merge-corruption's own notes).
//
// Deliberately NOT part of `npm run build` or `npm run test` (vitest) — run
// manually via `npm run test:e2e` before a release, or from the nightly-test
// GitHub Actions workflow.
// Everything runs at more than one devicePixelRatio. Obsidian is used on HiDPI
// laptops and on Windows with display scaling, where a hairline border lands on
// a fractional device pixel and can round away entirely — a whole class of
// "the line is missing" reports that simply cannot occur at dpr 1. It also keeps
// the pixel probes themselves honest: they read screenshots, which are in DEVICE
// pixels while every rect they derive expectations from is in CSS pixels, and a
// missing scale factor there reported every line in the table as absent.
export default defineConfig({
	testDir: './test/e2e',
	fullyParallel: true,
	reporter: 'list',
	globalSetup: path.join(__dirname, 'test/e2e/common/global-setup.ts'),
	use: {
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'dpr1', use: { deviceScaleFactor: 1 } },
		// 1.5 rather than 2: an integer ratio maps every CSS pixel onto a whole
		// number of device pixels, so it misses exactly the fractional-rounding
		// cases this dimension exists to cover.
		{ name: 'dpr1.5', use: { deviceScaleFactor: 1.5 } },
	],
});
