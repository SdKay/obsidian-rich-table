import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: "调整view宽度后，列选择器和表格错位了" — after dragging the
// outer-frame width handle to set a viewWidth WIDER than the table's own
// natural content width, .bt-table-wrapper centers the (narrower) table via
// margin-inline: auto, and the column-selector labels/resize seams drifted
// by exactly that centering gap. scrollContentOffset (renderGeometry.ts) is
// wrapper-relative — correct for a real sticky frozen cell, whose `left`
// resolves against the wrapper, but wrong for a non-frozen selector-strip
// cell living inside .bt-sel-track, which needs a TABLE-relative offset
// (tableContentOffset) since the track's own scroll transform already
// supplies the wrapper-relative component. See tableContentOffset's own doc
// comment in renderGeometry.ts for the full reasoning.
const SOURCE = tableSource({
	widths: [60, 60],
	rows: [{ 0: 'a1', 1: 'b1' }],
	viewWidth: 400, // much wider than the natural ~120px content width
});

async function hoverTable(page: import('@playwright/test').Page): Promise<void> {
	const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);
}

test('column-selector labels stay aligned with their real columns when the table is centered in a wider view', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	const cols = await page.locator('#root col[data-col]').all();
	expect(cols.length).toBe(2);
	for (const col of cols) {
		const ci = await col.getAttribute('data-col');
		const colBox = await col.evaluate(el => el.getBoundingClientRect());
		const cellBox = await page.locator(`.bt-col-selector .bt-sel-cell[data-idx="${ci}"]`).evaluate(el => el.getBoundingClientRect());
		expect(Math.abs(cellBox.left - colBox.left)).toBeLessThanOrEqual(1);
	}
});

test('column resize-handle seams stay on the real column boundary when the table is centered in a wider view', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	// Column 0's right edge is the boundary the FIRST resize handle drags —
	// the handle is a 9px-wide seam centered (translateX(-50%)) on that
	// boundary, so compare against its MIDPOINT, not its left edge.
	const col0Box = await page.locator('#root col[data-col="0"]').evaluate(el => el.getBoundingClientRect());
	const handleBox = await page.locator('.bt-sel-resize-col').first().evaluate(el => el.getBoundingClientRect());
	const handleMid = handleBox.left + handleBox.width / 2;
	expect(Math.abs(handleMid - col0Box.right)).toBeLessThanOrEqual(1);
});

// Mirror-image bug on the FROZEN branch: `.bt-col-selector`/`.bt-row-selector`
// themselves anchor to whichever edge is actually "flush" — the wrapper's
// edge when that axis needs to scroll (the regime scrollContentOffset was
// designed for, since that's also a real sticky cell's own reference frame),
// or the table's own edge when it doesn't (centered, nothing actually
// stuck). A frozen selector cell unconditionally used the wrapper-relative
// formula regardless of which regime it was actually in, drifting by the
// centering gap whenever a manual freeze was set on a table narrower than
// its view. Uses the real (sticky) header cell as ground truth, not <col> —
// <col> never reflects sticky positioning at all.
const FROZEN_SOURCE = tableSource({
	widths: [0, 0, 0, 0, 0, 0, 0], // auto-layout, same shape as the reported table
	rows: [{ 0: 'b' }, { 2: 'c' }, {}, {}, {}, {}, {}],
	theme: 'grid',
	freezeRows: 1,
	freezeCols: 2,
	viewWidth: 670,
	viewHeight: 197,
});

test('frozen column-selector labels stay aligned with their real (sticky) cells when the table is centered in a wider view', async ({ page, renderFull }) => {
	await renderFull(FROZEN_SOURCE);
	await hoverTable(page);

	for (const ci of [0, 1]) { // freezeCols: 2 → columns 0 and 1 are frozen
		const thBox = await page.locator(`th[data-row="0"][data-col="${ci}"]`).evaluate(el => el.getBoundingClientRect());
		const cellBox = await page.locator(`.bt-col-selector .bt-sel-cell[data-idx="${ci}"]`).evaluate(el => el.getBoundingClientRect());
		expect(Math.abs(cellBox.left - thBox.left)).toBeLessThanOrEqual(1);
	}
});

test('frozen row-selector labels stay aligned with their real (sticky) cells when the table is centered in a wider view', async ({ page, renderFull }) => {
	await renderFull(FROZEN_SOURCE);
	await hoverTable(page);

	// freezeRows: 1 → the header (row 0) and data row 1 are frozen.
	for (const ri of [0, 1]) {
		const cellSelector = ri === 0 ? 'th[data-row="0"][data-col="0"]' : `td[data-row="${ri}"][data-col="0"]`;
		const realBox = await page.locator(cellSelector).evaluate(el => el.getBoundingClientRect());
		const stripBox = await page.locator(`.bt-row-selector .bt-sel-cell[data-idx="${ri}"]`).evaluate(el => el.getBoundingClientRect());
		expect(Math.abs(stripBox.top - realBox.top)).toBeLessThanOrEqual(1);
	}
});

// Reported: "调窄table view宽度时，冻结列向右移动" — dragging the width
// handle to NARROW the view, crossing from "wide enough, no scroll" to
// "needs horizontal scroll", left the frozen column's real sticky cell and
// its selector-strip label at their PRE-drag offset. Two separate causes:
// (1) positionSelectors() (the cheap per-frame reposition the drag calls)
// never recomputed frozen cells' own --cl/--rx, which depend on the same
// scroll-regime check as the real cell; (2) applyFreeze's own ResizeObserver
// only watched <table>'s size, but table itself never resizes here — only
// wrapper does — so the real sticky cell was just as stale.
const NARROW_SOURCE = tableSource({
	widths: [60, 60, 60, 60, 60, 60],
	rows: [{ 0: 'a1', 1: 'b1', 2: 'c1', 3: 'd1' }],
	freezeCols: 2,
	viewWidth: 500, // wide enough that the 360px table needs no scroll at first
	viewHeight: 150,
});

test('narrowing the view via drag past the scroll threshold keeps the frozen column glued to the real cell', async ({ page, renderFull }) => {
	await renderFull(NARROW_SOURCE);
	await hoverTable(page);

	const handle = page.locator('.bt-view-resize-r');
	const handleBox = (await handle.boundingBox())!;
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
	await page.mouse.down();
	// -200px mouse delta → -400px view width (see the ×2 factor in the drag
	// handler) → viewWidth 500 → 100, well past the 360px scroll threshold.
	await page.mouse.move(handleBox.x + handleBox.width / 2 - 200, handleBox.y + handleBox.height / 2, { steps: 5 });

	const midDrag = await page.evaluate(() => {
		const th0 = document.querySelector('th[data-row="0"][data-col="0"]') as HTMLElement;
		const cell0 = document.querySelector('.bt-col-selector .bt-sel-cell[data-idx="0"]') as HTMLElement;
		return { thLeft: th0.getBoundingClientRect().left, cellLeft: cell0.getBoundingClientRect().left };
	});
	expect(Math.abs(midDrag.cellLeft - midDrag.thLeft)).toBeLessThanOrEqual(1);

	await page.mouse.up();
	await page.waitForTimeout(100); // let the rAF-coalesced freeze ResizeObserver settle
	const afterSettle = await page.evaluate(() => {
		const th0 = document.querySelector('th[data-row="0"][data-col="0"]') as HTMLElement;
		const cell0 = document.querySelector('.bt-col-selector .bt-sel-cell[data-idx="0"]') as HTMLElement;
		return { thLeft: th0.getBoundingClientRect().left, cellLeft: cell0.getBoundingClientRect().left };
	});
	expect(Math.abs(afterSettle.cellLeft - afterSettle.thLeft)).toBeLessThanOrEqual(1);
});

// Reported next: "冻结列整体在抖动" — watching applyFreeze's own <wrapper>
// via freezeResizeObs (the fix above) re-runs it on a rAF-coalesced delay,
// one frame behind the geometry onMove just wrote synchronously — visible as
// the frozen column stuttering back a pixel every other frame during a slow
// drag. Fixed by calling applyFreeze synchronously in onMove itself, same
// pattern already used there for updateOuterFrame.
test('a slow narrowing drag never moves the frozen column backwards frame-to-frame', async ({ page, renderFull }) => {
	await renderFull(NARROW_SOURCE);
	await hoverTable(page);

	await page.evaluate(() => {
		(window as unknown as { __btSamples: number[] }).__btSamples = [];
		const th0 = document.querySelector('th[data-row="0"][data-col="0"]') as HTMLElement;
		let n = 0;
		const sample = () => {
			if (n++ > 60) return;
			(window as unknown as { __btSamples: number[] }).__btSamples.push(th0.getBoundingClientRect().left);
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});

	const handle = page.locator('.bt-view-resize-r');
	const handleBox = (await handle.boundingBox())!;
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
	await page.mouse.down();
	const startX = handleBox.x + handleBox.width / 2;
	for (let i = 1; i <= 40; i++) {
		await page.mouse.move(startX - i * 2, handleBox.y + handleBox.height / 2);
		await page.waitForTimeout(16);
	}
	await page.mouse.up();
	await page.waitForTimeout(200);

	const samples = await page.evaluate(() => (window as unknown as { __btSamples: number[] }).__btSamples);
	for (let i = 1; i < samples.length; i++) {
		expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]! - 0.5);
	}
});
