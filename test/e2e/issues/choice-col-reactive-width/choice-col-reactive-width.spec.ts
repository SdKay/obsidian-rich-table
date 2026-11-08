import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// A typed column used to reserve enough width up front for its type's
// WIDEST POSSIBLE option label (colMinWidth), regardless of what any actual
// cell in the table showed — reported as wasted, distracting padding around
// a short real value (e.g. "Todo") in a column pre-sized for task-status's
// longest label ("In Progress"). Fixed by starting every column at the same
// plain 40px floor as any other, and growing it reactively — right when a
// choice cell's value is actually set to something that needs more room
// (growColForChoiceValue, renderAutofit.ts) — rather than up front for a
// value that may never occur in this table. Only grows, never shrinks: a
// column that's already wide enough for its widest PAST value shouldn't
// visibly resize just because the user later picks something shorter.

test('an explicitly-sized typed column keeps its own narrow width, not forced up to a reservation for its type\'s longest label', { tag: '@geometry' }, async ({ page, renderFull }) => {
	// 50px is comfortably below what the OLD formula would have forced this
	// column to (task-status's longest label, "In Progress", reserved ~112px
	// regardless of the explicit width given) — if that reservation still
	// applied, the column would render wider than the 50px actually set.
	await renderFull(tableSource({
		widths: [50],
		types: ['task-status'],
		rows: [{ 0: 'todo' }],
	}));
	const width = await page.locator('col[data-col="0"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	expect(width).toBe(50);
});

// growColForChoiceValue's reactive nudge only matters for a column with a
// width of its own — an auto column is sized to its content by the browser
// with no help needed. So these two exercise a column that starts with its
// own explicit (small) width, not an auto one.
const FIXED_SOURCE = tableSource({
	widths: [50],
	types: ['task-status'],
	rows: [{ 0: 'todo' }],
});

test('picking a longer value grows the column, and a shorter one afterwards does not shrink it back', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(FIXED_SOURCE);
	const widthBefore = await page.locator('col[data-col="0"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);

	const openMenuAndPick = (label: string) => page.evaluate((l) => {
		const menu = window.RichTableReal.ShimMenu.opened[window.RichTableReal.ShimMenu.opened.length - 1];
		menu.clickItem(l);
	}, label);

	await page.locator('[data-row="1"][data-col="0"]').click();
	await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);
	await openMenuAndPick('In Progress');
	const opsAfterGrow = await page.evaluate(() => (window as unknown as { __btOps: { type: string; width?: number }[] }).__btOps);
	const widthOp = opsAfterGrow.find(o => o.type === 'set-col-width');
	expect(widthOp, 'picking "In Progress" should have grown the column').toBeTruthy();
	expect(widthOp!.width).toBeGreaterThan(widthBefore);
	const grownWidth = widthOp!.width!;
	// Stands in for the rebuild the op would cause: the column is now that wide.
	await page.evaluate((w) => {
		document.querySelectorAll<HTMLElement>('[data-col="0"].bt-col-fixed').forEach(c => c.style.setProperty('--bt-cell-w', `${w}px`));
	}, grownWidth);

	await page.evaluate(() => { (window as unknown as { __btOps: unknown[] }).__btOps = []; });
	await page.locator('[data-row="1"][data-col="0"]').click();
	await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);
	await openMenuAndPick('Todo');

	const opsAfterShrinkAttempt = await page.evaluate(() => (window as unknown as { __btOps: { type: string }[] }).__btOps);
	expect(opsAfterShrinkAttempt.some(o => o.type === 'set-col-width'),
		'picking a shorter value should not resize the column at all').toBe(false);
});

// The claim in the comment above ("an auto column... needs no help") — an auto
// column beside one with a width, so a width op on it would be easy to mistake
// for one on its neighbour.
const MIXED_SOURCE = tableSource({
	widths: [50, 0],
	types: [undefined, 'task-status'],
	rows: [{ 0: 'x', 1: 'todo' }],
});

test('an auto typed column does not get a set-col-width op when a longer value is picked', async ({ page, renderFull }) => {
	await renderFull(MIXED_SOURCE);
	await expect(page.locator('[data-row="1"][data-col="1"]')).not.toHaveClass(/bt-col-fixed/);

	await page.locator('[data-row="1"][data-col="1"]').click();
	await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);
	await page.evaluate(() => {
		const menu = window.RichTableReal.ShimMenu.opened[window.RichTableReal.ShimMenu.opened.length - 1];
		menu.clickItem('In Progress');
	});

	const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string; colId?: string }[] }).__btOps);
	expect(ops.some(o => o.type === 'set-col-width'),
		'an auto column is sized by the browser, not nudged by the reactive choice-value grower').toBe(false);
});
