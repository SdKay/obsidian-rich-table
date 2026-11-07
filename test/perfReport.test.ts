import { describe, it, expect } from 'vitest';
import { group, render, findings, type Result } from './perf/report';

const limits = () => ({ maxExponent: 0.5, budgetMs: 100 });
const run = (scenario: string, feature: string, costs: number[]): Result[] => costs.map((ms, i) => ({ scenario, feature, size: [200, 400, 800][i]!, ms }));

describe('the scan report', () => {
	it('calls a flat, cheap line ok and a growing one growing', () => {
		const lines = group([...run('hover', 'plain', [4, 4, 4]), ...run('hover', 'merges', [10, 20, 40])], limits);
		expect(lines.find(l => l.feature === 'plain')!.verdict!.ok).toBe(true);
		expect(lines.find(l => l.feature === 'merges')!.verdict!.growing).toBe(true);
	});

	it('a line that could not run has no verdict and is a finding, since it measured nothing', () => {
		const lines = group([{ scenario: 'key', feature: 'plain', size: 200, broken: 'nothing selected' }, { scenario: 'key', feature: 'plain', size: 400, broken: 'nothing selected' }], limits);
		expect(lines[0]!.verdict).toBeUndefined();
		expect(lines[0]!.broken).toBe('nothing selected');
		expect(findings(lines)).toHaveLength(1);
	});

	it('one size alone gives no slope, so it is reported as unable to judge', () => {
		const lines = group(run('hover', 'plain', [4]), limits);
		expect(lines[0]!.verdict).toBeUndefined();
		expect(findings(lines)).toHaveLength(1);
	});

	it('uses the limits of each scenario', () => {
		const lines = group([...run('rebuild', 'plain', [300, 300, 300])], s => (s === 'rebuild' ? { maxExponent: 1, budgetMs: 1000 } : { maxExponent: 0.5, budgetMs: 100 }));
		expect(lines[0]!.verdict!.ok).toBe(true);
	});

	it('an interaction that does not exist for a feature is shown as not applicable and is no finding', () => {
		const lines = group([{ scenario: 'rebuild:set-col-width', feature: 'kanban', size: 200, skipped: 'a board has no column' }, { scenario: 'rebuild:set-col-width', feature: 'kanban', size: 400, skipped: 'a board has no column' }], limits);
		expect(lines).toHaveLength(1);
		expect(findings(lines)).toEqual([]);
		expect(render(lines, [200, 400])).toMatch(/kanban\s.*n\/a: a board has no column/);
	});

	it('several runs of one size count as one point, their median, so a single spike does not make a line grow', () => {
		const runs = (ms: number[]) => ms.map((m, i): Result => ({ scenario: 'rebuild', feature: 'plain', size: [200, 400, 800][Math.floor(i / 3)]!, ms: m }));
		// 800 rows: 300, 300 and one 2000 ms collection.
		const lines = group(runs([100, 100, 100, 200, 200, 200, 300, 2000, 300]), () => ({ maxExponent: 1.3, budgetMs: 5000 }));
		expect(lines[0]!.points).toEqual([{ size: 200, cost: 100 }, { size: 400, cost: 200 }, { size: 800, cost: 300 }]);
		expect(lines[0]!.verdict!.ok).toBe(true);
	});

	it('the limit for a redraw separates linear work from work that outgrows the table, as measured before and after the fixes', () => {
		const redraw = { maxExponent: 1.3, budgetMs: 5000 };
		const at = (feature: string, ms: number[]) => group(ms.map((m, i): Result => ({ scenario: 'rebuild', feature, size: [200, 400, 800][i]!, ms: m })), () => redraw)[0]!;
		// Before the fixes, 800 rows of style rules or of merges took 3.6 s and 1.1 s and grew faster than the table.
		expect(at('styles', [435, 1438, 3648]).verdict!.growing).toBe(true);
		expect(at('merges', [120, 246, 1053]).verdict!.growing).toBe(true);
		// After, and for every other feature, the cost followed the table's size.
		expect(at('styles', [105, 193, 500]).verdict!.growing).toBe(false);
		expect(at('filter', [56.7, 156, 291]).verdict!.growing).toBe(false);
		expect(at('autoLayout', [143, 309, 716]).verdict!.growing).toBe(false);
	});

	it('lays the lines out as a table with a column per size and a verdict', () => {
		const lines = group([...run('hover', 'plain', [4, 4, 4]), ...run('hover', 'merges', [10, 20, 400])], limits);
		const text = render(lines, [200, 400, 800]);
		expect(text.split('\n')[0]).toMatch(/scenario\s+feature\s+200 rows\s+400 rows\s+800 rows\s+exponent\s+forced\s+verdict/);
		// A scenario that does not count forced layouts shows a dash there.
		expect(text).toMatch(/hover\s+plain\s+4\.0\s+4\.0\s+4\.0\s+0\.00\s+-\s+ok/);
		expect(text).toMatch(/hover\s+merges\s+10\.0\s+20\.0\s+400\s+.*GROWS\+SLOW/);
	});

	it('findings are the lines that are not ok, and nothing when all are', () => {
		expect(findings(group(run('hover', 'plain', [4, 4, 4]), limits))).toEqual([]);
		expect(findings(group(run('hover', 'merges', [10, 20, 400]), limits))).toHaveLength(1);
	});
});

describe('the scan report, with script apart from the total', () => {
	const timed = (feature: string, rows: [number, number][]): Result[] => rows.map(([ms, script], i) => ({ scenario: 'zoom', feature, size: [200, 400, 800][i]!, ms, script }));
	const gesture = () => ({ maxExponent: 1.2, budgetMs: 100 });

	it('reads growth from the script when every result has it', () => {
		// The total grows faster than the table (browser layout); the script is flat.
		const lines = group(timed('plain', [[30, 3], [90, 3], [270, 3]]), gesture);
		expect(lines[0]!.verdict!.growing).toBe(false);
		expect(lines[0]!.verdict!.overBudget).toBe(true); // 270 ms in all, which is still the user's wait
		expect(lines[0]!.verdict!.ok).toBe(false);
	});

	it('flags a script that outgrows the table', () => {
		const lines = group(timed('merges', [[10, 4], [40, 16], [160, 64]]), gesture);
		expect(lines[0]!.verdict!.growing).toBe(true);
	});

	it('falls back to the total when some result lacks the script figure', () => {
		const mixed: Result[] = [{ scenario: 'zoom', feature: 'plain', size: 200, ms: 5, script: 1 }, { scenario: 'zoom', feature: 'plain', size: 400, ms: 20 }, { scenario: 'zoom', feature: 'plain', size: 800, ms: 80, script: 1 }];
		const lines = group(mixed, gesture);
		expect(lines[0]!.verdict!.growing).toBe(true);
	});
});

describe('the scan report, with layouts the script forced', () => {
	const gesture = () => ({ maxExponent: 1.2, budgetMs: 100, maxForced: 2 });
	const at = (forced: number[], extra: Partial<Result> = {}): Result[] => forced.map((f, i) => ({ scenario: 'drag-view-size', feature: 'plain', size: [200, 400, 800][i]!, ms: 20, script: 3, layouts: f + 1, forced: f, ...extra }));

	it('flags a gesture whose step forces more layouts than the limit, at the largest size, though it is cheap and flat', () => {
		const lines = group(at([13, 13, 13]), gesture);
		expect(lines[0]!.forced).toBe(13);
		expect(lines[0]!.forcesLayouts).toBe(true);
		expect(lines[0]!.verdict!.ok).toBe(true);
		expect(findings(lines)).toHaveLength(1);
		expect(render(lines, [200, 400, 800])).toMatch(/FORCES/);
	});

	it('lets a gesture force up to the limit', () => {
		const lines = group(at([2, 2, 2]), gesture);
		expect(lines[0]!.forcesLayouts).toBe(false);
		expect(findings(lines)).toEqual([]);
	});

	it('reads the count at the largest size, not the smallest', () => {
		expect(group(at([1, 1, 9]), gesture)[0]!.forcesLayouts).toBe(true);
		expect(group(at([9, 1, 1]), gesture)[0]!.forcesLayouts).toBe(false);
	});

	it('takes the median of the runs of one size, so one traced spike does not flag it', () => {
		const runs: Result[] = [1, 1, 30].map(f => ({ scenario: 'zoom', feature: 'plain', size: 800, ms: 20, forced: f }))
			.concat([1, 1, 1].map(f => ({ scenario: 'zoom', feature: 'plain', size: 200, ms: 10, forced: f })));
		expect(group(runs, gesture)[0]!.forcesLayouts).toBe(false);
	});

	it('does not judge a scenario that does not count them, or one whose limits set no cap', () => {
		const plain = group([200, 400, 800].map((size): Result => ({ scenario: 'rebuild:x', feature: 'plain', size, ms: 100 })), () => ({ maxExponent: 1.3, budgetMs: 1000 }));
		expect(plain[0]!.forced).toBeUndefined();
		expect(plain[0]!.forcesLayouts).toBeUndefined();
		const capless = group(at([13, 13, 13]), () => ({ maxExponent: 1.2, budgetMs: 100 }));
		expect(capless[0]!.forcesLayouts).toBe(false);
	});

	it('does not judge a line where only some runs have the count', () => {
		const mixed: Result[] = [{ scenario: 'z', feature: 'p', size: 200, ms: 5, forced: 9 }, { scenario: 'z', feature: 'p', size: 400, ms: 6 }, { scenario: 'z', feature: 'p', size: 800, ms: 7, forced: 9 }];
		expect(group(mixed, gesture)[0]!.forced).toBeUndefined();
	});
});

describe('the ceilings on forced layouts', () => {
	it('hold a gesture that is known to force more to where it stands, and the rest to the default', async () => {
		const { limitsFor, FORCED_CEILING } = await import('./perf/summarize');
		expect(limitsFor('arrow-keys').maxForced).toBe(2);
		expect(limitsFor('hover').maxForced).toBe(FORCED_CEILING.hover);
		expect(limitsFor('drag-view-size').maxForced).toBe(FORCED_CEILING['drag-view-size']);
		expect(limitsFor('rebuild:set-title').maxForced).toBeUndefined();
	});

	it('give the zoom slider the room the browser\'s own layout needs, and every other gesture the default budget', async () => {
		const { limitsFor, LIMITS } = await import('./perf/summarize');
		expect(limitsFor('zoom-slider').budgetMs).toBeGreaterThan(LIMITS.interaction!.budgetMs);
		expect(limitsFor('drag-view-size').budgetMs).toBeGreaterThan(LIMITS.interaction!.budgetMs);
		expect(limitsFor('arrow-keys').budgetMs).toBe(LIMITS.interaction!.budgetMs);
		expect(limitsFor('rebuild:set-title').budgetMs).toBe(LIMITS.rebuild!.budgetMs);
	});

	it('let the transpose grow a little faster than the other edits, which it does by changing the shape of the table', async () => {
		const { limitsFor, LIMITS } = await import('./perf/summarize');
		expect(limitsFor('rebuild:transpose').maxExponent).toBeGreaterThan(LIMITS.rebuild!.maxExponent);
		expect(limitsFor('rebuild:set-title').maxExponent).toBe(LIMITS.rebuild!.maxExponent);
		// Still well below what work that outgrows the table measured (2.3 for the split before it was fixed).
		expect(limitsFor('rebuild:transpose').maxExponent).toBeLessThan(2);
	});

	it('are below what the gestures forced before they were improved, so going back is caught', async () => {
		const { FORCED_CEILING } = await import('./perf/summarize');
		// Measured before the fix: view size 13 on the plain table and 14 on the combined one, column width 8, row height 7.3.
		expect(FORCED_CEILING['drag-view-size']).toBeLessThan(14);
		expect(FORCED_CEILING['drag-col-width']).toBeLessThan(8);
		expect(FORCED_CEILING['drag-row-height']!).toBeLessThan(7.3);
	});
});
