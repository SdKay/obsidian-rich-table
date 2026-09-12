import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: hovering a nested rich-table pushed the whole (already small,
// cramped) nested table sideways within its own cell, then snapped back on
// mouseleave — reserveLeftPad's own hover-only reserve/collapse cycle
// (renderer.ts). A nested table renders via the exact same renderTable() call
// as any top-level one — no isNested branch, no special-casing — so the fix
// is a plain, universal one: --bt-sel-pad-left is now reserved permanently
// for every table, the same treatment --bt-sel-pad (top) already had. A
// top-level table sitting in the wide reading pane doesn't visibly suffer
// from this (there's plenty of room either way), and a nested table's much
// smaller, tighter cell no longer visibly shifts on hover — one rule,
// checked here against a plain table with no nested-specific setup at all.
const SOURCE = tableSource({ widths: [60], rows: [{ 0: 'x' }] });

test('reserveSelectorLeftPad reserves room for the selector strips against a flush-left table', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const before = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad-left')) || 0);
	expect(before, 'nothing has reserved this yet').toBe(0);

	await page.evaluate(() => {
		const root = document.querySelector<HTMLElement>('.bt-render-root')!;
		const wrapper = root.querySelector<HTMLElement>('.bt-table-wrapper')!;
		// .bt-table-wrapper centers within root via margin-inline:auto — this
		// test's shell is a wide viewport with a narrow table, leaving plenty of
		// natural centering slack on both sides. Pin root's own width to the
		// wrapper's natural content width to remove that slack, matching a
		// table with no room of its own to spare (e.g. a nested table's cell).
		root.style.width = `${wrapper.getBoundingClientRect().width}px`;
		window.RichTableReal.reserveSelectorLeftPad(root);
	});

	const after = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad-left')) || 0);
	// 54px = SEL_TOTAL(32) + AUTOFIT_OFFSET(18) + 4 (selectorLayout.ts) — this
	// table has real selector strips (not locked), and the test shell's root
	// starts flush against its container with no natural margin of its own.
	expect(after).toBe(54);
});

test("a table's left-padding reservation survives mouseleave — no longer collapsed back to 0", async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	// Same "remove the shell's own wide-viewport centering slack" step as the
	// direct-function test above, before the FIRST hover — real mouseenter
	// measures live geometry too.
	await page.evaluate(() => {
		const root = document.querySelector<HTMLElement>('.bt-render-root')!;
		const wrapper = root.querySelector<HTMLElement>('.bt-table-wrapper')!;
		root.style.width = `${wrapper.getBoundingClientRect().width}px`;
	});

	const wrapperBox = (await page.locator('.bt-table-wrapper').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	const hoveredPad = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad-left')) || 0);
	expect(hoveredPad, 'hovering reserves the room').toBeGreaterThan(0);

	await page.mouse.move(0, 0);
	// hideSelectors debounces the actual hide (and restoreLayout with it) by
	// 80ms (scheduleSelHide) — read after that settles, not immediately.
	await page.waitForTimeout(150);
	const afterLeavePad = await page.locator('.bt-render-root').evaluate(el =>
		parseFloat((el as HTMLElement).style.getPropertyValue('--bt-sel-pad-left')) || 0);
	expect(afterLeavePad, 'must not collapse this back to 0 on mouseleave').toBe(hoveredPad);
});
