import { defineConfig } from '@playwright/test';

// Performance scan: how the cost of each interaction grows with the size of the table. Kept out of test/e2e so that
// `npm run test:e2e` never runs it; run it with `npm run perf`. One worker and a long timeout, since a measurement
// that shares the machine with another is not a measurement.
export default defineConfig({
	testDir: './test/perf',
	fullyParallel: false,
	workers: 1,
	timeout: 300_000,
	reporter: 'list',
	globalSetup: './test/perf/global-setup.ts',
	projects: [{ name: 'perf', use: { deviceScaleFactor: 1 } }],
});
