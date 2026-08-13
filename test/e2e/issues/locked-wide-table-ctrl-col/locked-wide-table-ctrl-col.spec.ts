import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: on a wide table, once locked, the top-left unlock button became
// permanently invisible. Root cause was two ANDed gaps in renderer.ts:
//
// 1. `prepareLayout()` — which reserves `--bt-sel-pad-left` (root's own
//    padding-left) so the left-side strips have room to render instead of
//    landing at a negative left and getting clipped — only ever ran from a
//    `mouseenter` handler gated on `onStructuralOp`. A locked table has no
//    `onStructuralOp` (row/col selectors don't exist while locked), so that
//    whole handler — and the padding reservation with it — never ran.
// 2. The lock button (`.bt-ctrl-col`/`.bt-ctrl-btn`) stays visible on a locked
//    table via `.is-locked`'s permanent `opacity: 1`, independent of hover —
//    so unlike every other left-side strip, it needed to be positioned
//    correctly from the very FIRST paint, not just after a hover that would
//    never usefully happen anyway (nothing to see there yet).
//
// A narrow table has enough natural left margin regardless, so `--cc-left`
// still lands on-screen even with 0px reserved — which is why this only ever
// showed up on a wide one.
test.describe('locked wide table — ctrl column stays reachable', () => {
	const WIDE_LOCKED = tableSource({
		widths: [150, 150, 150, 150, 150, 150, 150, 150],
		rows: [{ 0: 'a1' }, { 0: 'a2' }],
		viewWidth: 300,
		locked: true,
	});

	const lockBtnBox = (page: import('@playwright/test').Page) =>
		page.locator('.bt-ctrl-col .bt-ctrl-btn.is-locked').boundingBox();

	test('unlock button is on-screen without ever hovering the table', async ({ page, renderFull }) => {
		// The bug only shows up when the table's container has no natural
		// left margin to spare — Playwright's default (much wider) viewport
		// leaves so much room around a 300px-wide wrapper that even an
		// unreserved, un-padded left position still happens to land on-screen.
		// Narrowing the viewport to roughly the wrapper's own width reproduces
		// the "table fills its container flush-left" case the real bug needs.
		await page.setViewportSize({ width: 340, height: 400 });
		await renderFull(WIDE_LOCKED);
		// Deliberately no mouse interaction at all before this assertion — the
		// button must be correctly positioned from first paint, since .is-locked
		// makes it visible independently of hover.
		const box = await lockBtnBox(page);
		expect(box, 'lock button should exist in the DOM').not.toBeNull();
		expect(box!.x, 'lock button rendered at a negative/off-screen left').toBeGreaterThanOrEqual(0);
	});

	test('unlock button is clickable and dispatches toggle-lock', async ({ page, renderFull }) => {
		await page.setViewportSize({ width: 340, height: 400 });
		await renderFull(WIDE_LOCKED);
		await page.locator('.bt-ctrl-col .bt-ctrl-btn.is-locked').click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toEqual([{ type: 'toggle-lock' }]);
	});

	test('a narrow locked table is unaffected (sanity check the fixture itself)', async ({ page, renderFull }) => {
		const NARROW_LOCKED = tableSource({
			widths: [80, 80],
			rows: [{ 0: 'a1' }],
			locked: true,
		});
		await renderFull(NARROW_LOCKED);
		const box = await lockBtnBox(page);
		expect(box!.x).toBeGreaterThanOrEqual(0);
	});

	test('unlock button sits close to the table, not reserving room for a nonexistent selector strip', async ({ page, renderFull }) => {
		// A locked table has no row/col selectors at all (onStructuralOp gates
		// them off), so the gap the ctrl column needs to clear is just its own
		// icon width — not the full row-selector-strip-sized gap a table with
		// selectors reserves. Asserting a small gap here is what would catch a
		// regression back to the wider, selector-sized reservation.
		await page.setViewportSize({ width: 340, height: 400 });
		await renderFull(WIDE_LOCKED);
		const wrapperLeft = (await page.locator('.bt-table-wrapper').boundingBox())!.x;
		const box = await lockBtnBox(page);
		expect(wrapperLeft - box!.x - box!.width, 'unlock button sits further from the table than it needs to')
			.toBeLessThan(10);
	});
});
