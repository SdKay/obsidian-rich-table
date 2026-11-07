import fs from 'node:fs';
import { test } from '../e2e/common/test-base';
import { tableSource, evidenceFor, type Feature } from './tables';
import { costOf, layoutsOf, median, ScenarioBroken, hoverBody, hoverOnBody, selectionMarks, keyBody, selectCellBody, selectStripBody, dragSelectBody, dragBody, releaseDrag, scrollBody, editorBody, filterPanelBody, zoomBody } from './measure';
import type { Result } from './report';
import { GESTURE_IDS } from './gestures';
import { chosen } from './tier';
import type { Page } from '@playwright/test';

// What the user feels while working in the table: the cost of one gesture, as main-thread work the browser did for it.
// Each gesture is run on tables of three sizes with each feature on; a gesture whose cost follows the size of the table
// is the finding. A gesture the view does not have (a board has no column strip) is skipped, not tried.
const SIZES = chosen.sizes;
const ONLY_SCENARIOS = process.env.SCENARIOS?.split(',');
const OUT = process.env.PERF_OUT ?? 'test-results/perf-interactions.jsonl';
const ROUNDS = chosen.rounds;
const REPS = 6;
const CELL = 'td.bt-td[data-row="8"][data-col="5"]';

const BOARDS: readonly Feature[] = ['kanban', 'calendar'];
const BOARD_ONLY_REASON = 'a board view has no table to do this on';

/** How a gesture is observed: timed with `costOf`, or traced with `layoutsOf`. */
type Measure<R> = (page: Page, reps: number, body: (arg: never) => Promise<void>, arg: never) => Promise<R>;

interface Scenario {
	id: string;
	/** What to do before measuring, so that the gesture has what it works on (a selection, the strips up). */
	setup?: (page: Page) => Promise<void>;
	run: <R>(page: Page, reps: number, measure: Measure<R>) => Promise<R>;
	/** Undoes what the gesture left held, outside the measured part. */
	after?: (page: Page) => Promise<void>;
	/** Features it does not apply to, and why. */
	skip?: (f: Feature) => string | undefined;
}

const notOnBoards = (f: Feature) => (BOARDS.includes(f) ? BOARD_ONLY_REASON : undefined);
const hoverFirst = (page: Page) => page.evaluate(hoverOnBody, { cell: CELL });
const proveStripSelects = (axis: 'col' | 'row') => async (page: Page) => {
	await hoverFirst(page);
	if ((await page.evaluate(selectionMarks, { axis })) === 0) throw new ScenarioBroken(`pressing the ${axis} strip marked no cell as selected`);
};
const drag = (selector: string, index: number, axis: 'x' | 'y' | 'xy', step: number, watch: string) => <R,>(page: Page, reps: number, measure: Measure<R>) =>
	measure(page, reps, dragBody, { selector, index, axis, steps: reps, step, watch });

const SCENARIOS: Scenario[] = [
	{ id: 'hover', run: (p, n, m) => m(p, n, hoverBody, { cell: CELL }), skip: notOnBoards },
	{
		id: 'arrow-keys', skip: notOnBoards,
		setup: async p => { await p.evaluate(selectCellBody, { cell: CELL }); },
		run: (p, n, m) => m(p, n, keyBody, {}),
	},
	{ id: 'select-column', setup: proveStripSelects('col'), run: (p, n, m) => m(p, n, selectStripBody, { axis: 'col' as const }), skip: notOnBoards },
	{ id: 'select-row', setup: proveStripSelects('row'), run: (p, n, m) => m(p, n, selectStripBody, { axis: 'row' as const }), skip: notOnBoards },
	{ id: 'drag-select', run: (p, n, m) => m(p, n, dragSelectBody, {}), skip: notOnBoards },
	{ id: 'open-editor', run: (p, n, m) => m(p, n, editorBody, {}), skip: notOnBoards },
	{ id: 'scroll', run: (p, n, m) => m(p, n, scrollBody, {}), skip: notOnBoards },
	{ id: 'filter-panel', run: (p, n, m) => m(p, n, filterPanelBody, {}), skip: notOnBoards },
	{ id: 'zoom-slider', run: (p, n, m) => m(p, n, zoomBody, {}), skip: notOnBoards },
	{ id: 'drag-col-width', setup: hoverFirst, run: drag('.bt-col-selector .bt-sel-resize-col', 4, 'x', 3, 'table.bt-table'), after: releaseDragSafely, skip: notOnBoards },
	{ id: 'drag-row-height', setup: hoverFirst, run: drag('.bt-row-selector .bt-sel-resize-row', 8, 'y', 3, 'table.bt-table'), after: releaseDragSafely, skip: notOnBoards },
	{ id: 'drag-view-size', setup: hoverFirst, run: drag('.bt-view-resize-br', 0, 'xy', 3, '.bt-table-wrapper'), after: releaseDragSafely, skip: notOnBoards },
	{ id: 'drag-status-divider', run: drag('.bt-status-divider', 0, 'x', -3, '.bt-status-scroll'), after: releaseDragSafely, skip: notOnBoards },
];

async function releaseDragSafely(page: Page) {
	await releaseDrag(page).catch(() => undefined);
}

const unlisted = SCENARIOS.filter(s => !(GESTURE_IDS as readonly string[]).includes(s.id)).map(s => s.id);
if (unlisted.length > 0 || SCENARIOS.length !== GESTURE_IDS.length) throw new Error(`gestures.ts and the scenarios disagree: ${unlisted.join(', ')}`);

const wanted = SCENARIOS.filter(s => !ONLY_SCENARIOS || ONLY_SCENARIOS.includes(s.id));

for (const feature of chosen.gestureTables) {
	for (const size of SIZES) {
		test(`interactions: ${feature}, ${size} rows`, async ({ page, renderFull }) => {
			await page.setViewportSize({ width: 1200, height: 800 });
			fs.mkdirSync('test-results', { recursive: true });
			const note = (r: Result) => fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
			// A first render thrown away: the first of a page pays for fonts, styles and JIT.
			await renderFull(tableSource(40, 'plain'), { singleClickEdit: true });
			await renderFull(tableSource(size, feature), { singleClickEdit: true });
			await page.waitForTimeout(500);
			for (const ev of evidenceFor(feature)) {
				if (!(await page.evaluate(ev.check))) throw new ScenarioBroken(`the feature did not take effect: ${ev.what}`);
			}
			for (const s of wanted) {
				const result: Result = { scenario: s.id, feature, size };
				const why = s.skip?.(feature);
				if (why) { result.skipped = why; note(result); continue; }
				const costs: number[] = [], scripts: number[] = [];
				let forced: number | undefined, layouts: number | undefined;
				try {
					for (let round = 0; round < ROUNDS; round++) {
						await s.setup?.(page);
						try {
							const c = await s.run(page, REPS, costOf as Measure<Awaited<ReturnType<typeof costOf>>>);
							costs.push(c.task);
							scripts.push(c.script);
						} finally {
							await s.after?.(page);
							await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
						}
					}
					result.ms = median(costs);
					result.script = median(scripts);
					// Layouts are counted from a trace of one more run, apart from the timed ones, since tracing slows the page.
					await s.setup?.(page);
					try {
						const l = await s.run(page, REPS, layoutsOf as Measure<Awaited<ReturnType<typeof layoutsOf>>>);
						layouts = l.layouts; forced = l.forced;
					} finally {
						await s.after?.(page);
						await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
					}
					result.layouts = layouts;
					result.forced = forced;
				} catch (e) {
					if (!(e instanceof ScenarioBroken)) throw e;
					result.broken = e.message;
				}
				note(result);
			}
		});
	}
}
