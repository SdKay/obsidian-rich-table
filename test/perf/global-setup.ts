import fs from 'node:fs';
import globalSetup from '../e2e/common/global-setup';

// The e2e bundle, rebuilt; and the last scan's results cleared, so a report never mixes two runs (PERF_KEEP=1 adds to them).
export default function perfSetup(): void {
	globalSetup();
	if (process.env.PERF_KEEP) return;
	for (const f of ['test-results/perf-rebuild.jsonl', 'test-results/perf-interactions.jsonl']) fs.rmSync(f, { force: true });
}
