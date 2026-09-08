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

const SOURCE = tableSource({
	widths: [0], // no explicit width: auto-layout, exercises colMinWidth's floor directly
	types: ['task-status'],
	rows: [{ 0: 'todo' }],
});

test('an explicitly-sized typed column keeps its own narrow width, not forced up to a reservation for its type\'s longest label', async ({ page, renderFull }) => {
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

test('picking a longer value grows the column to fit it', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	const widthBefore = await page.locator('col[data-col="0"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);

	await page.locator('[data-row="1"][data-col="0"]').click();
	await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);
	await page.evaluate(() => {
		const menu = window.RichTableReal.ShimMenu.opened[window.RichTableReal.ShimMenu.opened.length - 1];
		menu.clickItem('In Progress');
	});

	const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string; colId?: string; width?: number }[] }).__btOps);
	const widthOp = ops.find(o => o.type === 'set-col-width');
	expect(widthOp, 'picking "In Progress" should have grown the column').toBeTruthy();
	expect(widthOp!.width).toBeGreaterThan(widthBefore);
});

test('picking a shorter value afterwards does not shrink the column back', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const openMenuAndPick = (label: string) => page.evaluate((l) => {
		const menu = window.RichTableReal.ShimMenu.opened[window.RichTableReal.ShimMenu.opened.length - 1];
		menu.clickItem(l);
	}, label);

	await page.locator('[data-row="1"][data-col="0"]').click();
	await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);
	await openMenuAndPick('In Progress');
	const opsAfterGrow = await page.evaluate(() => (window as unknown as { __btOps: { type: string; width?: number }[] }).__btOps);
	const grownWidth = opsAfterGrow.find(o => o.type === 'set-col-width')!.width!;
	await page.evaluate((w) => {
		document.querySelector<HTMLElement>('col[data-col="0"]')!.style.width = `${w}px`;
	}, grownWidth);

	await page.evaluate(() => { (window as unknown as { __btOps: unknown[] }).__btOps = []; });
	await page.locator('[data-row="1"][data-col="0"]').click();
	await expect.poll(() => page.evaluate(() => !!window.RichTableReal.getActiveCellMenu())).toBe(true);
	await openMenuAndPick('Todo');

	const opsAfterShrinkAttempt = await page.evaluate(() => (window as unknown as { __btOps: { type: string }[] }).__btOps);
	expect(opsAfterShrinkAttempt.some(o => o.type === 'set-col-width'),
		'picking a shorter value should not resize the column at all').toBe(false);
});
