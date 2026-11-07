/**
 * Reads the scan's results file and prints the report. Run with `npx tsx test/perf/summarize.ts <file>`; also used by
 * the scan itself at the end of a run.
 */
import fs from 'node:fs';
import { group, render, findings, type Result } from './report';
import type { Limits } from './fit';

/**
 * A gesture's own script may grow with the table as far as the cells it touches do (selecting a column marks every
 * cell in it) but not faster: 1.2, as linear measures 0.8 to 1.2 and what was quadratic measured 1.5 and more. The total
 * is held to a budget, since the browser's style and layout of a larger table are part of what the user waits for.
 * A redraw of the whole table after an edit is linear by design today, so it is allowed a slope up to 1.3.
 */
export const LIMITS: Record<string, Limits> = {
	interaction: { maxExponent: 1.2, budgetMs: 100, maxForced: 2 },
	rebuild: { maxExponent: 1.3, budgetMs: 1000 },
};

/**
 * Layouts a gesture's script may force per step. A step ideally lays the table out once; these gestures are known to
 * force more, and their ceiling is where they stand with room for noise, so a change that makes one worse is caught
 * and lowering a ceiling is how an improvement is kept. Any gesture not listed is held to the default.
 */
export const FORCED_CEILING: Readonly<Record<string, number>> = {
	'drag-view-size': 13,
	'drag-col-width': 7,
	'drag-row-height': 6,
	'zoom-slider': 8,
	'drag-status-divider': 4,
	// Every hover of a table with a title: updateOuterFrame reads the title again after writing the frame.
	hover: 6,
};

/**
 * Gestures whose cost is the browser laying the table out again, with little script of the plugin's own: zooming is one
 * CSS property on the whole table, and resizing the view lays out every row (about 100 ms at 800 rows with every feature
 * on, the same before the fixes to its layouts). Held to where they stand.
 */
export const BUDGET_MS: Readonly<Record<string, number>> = {
	'zoom-slider': 250,
	'drag-view-size': 150,
};

/**
 * Transposing turns rows into columns, so 800 rows become 800 columns of a dozen rows: the cost follows the columns,
 * which the strips and the layout handle less cheaply than rows. It is the table's shape that changes, not the work per
 * cell, and it measured 1.3 to 1.4 every time it was looked at.
 */
const REBUILD_EXPONENT: Readonly<Record<string, number>> = {
	'rebuild:transpose': 1.5,
};

export const limitsFor = (scenario: string): Limits => {
	if (scenario.startsWith('rebuild')) return { ...LIMITS.rebuild!, maxExponent: REBUILD_EXPONENT[scenario] ?? LIMITS.rebuild!.maxExponent };
	return { ...LIMITS.interaction!, maxForced: FORCED_CEILING[scenario] ?? LIMITS.interaction!.maxForced, budgetMs: BUDGET_MS[scenario] ?? LIMITS.interaction!.budgetMs };
};

export function summarize(file: string, sizes: readonly number[]): { text: string; failed: number } {
	const results = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Result);
	const lines = group(results, limitsFor);
	const bad = findings(lines);
	return { text: render(lines, sizes), failed: bad.length };
}

if (process.argv[1] && /summarize\.ts$/.test(process.argv[1])) {
	const file = process.argv[2] ?? 'test-results/perf-rebuild.jsonl';
	const sizes = (process.argv[3] ?? '200,400,800').split(',').map(Number);
	const { text, failed } = summarize(file, sizes);
	console.log(text);
	console.log(`\n${failed} line(s) need attention`);
}
