import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Row/column drag-reorder moved off a dedicated drag-grip sub-zone (removed
// alongside the rest of the selector strip's grip/label split, see
// selectorLayout.ts's own doc comment) onto Ctrl/Cmd+drag on the selector
// strip itself, plus a keyboard equivalent (Alt+Shift+Arrow). A plain drag
// (no modifier) still means range-select — these tests exercise both new
// entry points and confirm the modifier actually switches behavior.
const SOURCE = tableSource({
	widths: [60, 60, 60],
	rows: [{ 0: 'a1', 1: 'b1', 2: 'c1' }, { 0: 'a2', 1: 'b2', 2: 'c2' }, { 0: 'a3', 1: 'b3', 2: 'c3' }],
});

async function hoverTable(page: import('@playwright/test').Page) {
	const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);
}

test('Ctrl+drag on the column selector dispatches move-col, not a range selection', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	const colA = page.locator('.bt-col-selector [data-idx="0"]');
	const colC = page.locator('.bt-col-selector [data-idx="2"]');
	const boxA = (await colA.boundingBox())!;
	const boxC = (await colC.boundingBox())!;

	await colA.evaluate((el: HTMLElement, x: number) => {
		el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, ctrlKey: true, clientX: x, clientY: 10, bubbles: true, cancelable: true }));
	}, boxA.x + boxA.width / 2);
	await colC.evaluate((el: HTMLElement, x: number) => {
		el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, ctrlKey: true, clientX: x, clientY: 10, bubbles: true, cancelable: true }));
	}, boxC.x + boxC.width / 2);
	await colC.evaluate((el: HTMLElement, x: number) => {
		el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, ctrlKey: true, clientX: x, clientY: 10, bubbles: true, cancelable: true }));
	}, boxC.x + boxC.width / 2);

	const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
	expect(ops).toEqual([{ type: 'move-col', fromColId: 'c_0', toColId: 'c_2' }]);
});

test('a plain drag (no Ctrl) on the column selector still opens the range-selection panel, not a reorder', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	const colA = page.locator('.bt-col-selector [data-idx="0"]');
	const boxA = (await colA.boundingBox())!;
	await colA.evaluate((el: HTMLElement, x: number) => {
		el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: x, clientY: 10, bubbles: true, cancelable: true }));
	}, boxA.x + boxA.width / 2);
	await colA.evaluate((el: HTMLElement, x: number) => {
		el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: 10, bubbles: true, cancelable: true }));
	}, boxA.x + boxA.width / 2);

	await expect(page.locator('.bt-cell-panel')).toBeVisible();
	const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
	expect(ops.filter((o: any) => o.type === 'move-col')).toEqual([]);
});

test('Cmd (metaKey)+drag on the row selector dispatches move-row', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	const row1 = page.locator('.bt-row-selector [data-idx="1"]');
	const row3 = page.locator('.bt-row-selector [data-idx="3"]');
	const box1 = (await row1.boundingBox())!;
	const box3 = (await row3.boundingBox())!;

	await row1.evaluate((el: HTMLElement, y: number) => {
		el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, metaKey: true, clientX: 10, clientY: y, bubbles: true, cancelable: true }));
	}, box1.y + box1.height / 2);
	await row3.evaluate((el: HTMLElement, y: number) => {
		el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, metaKey: true, clientX: 10, clientY: y, bubbles: true, cancelable: true }));
	}, box3.y + box3.height / 2);
	await row3.evaluate((el: HTMLElement, y: number) => {
		el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, metaKey: true, clientX: 10, clientY: y, bubbles: true, cancelable: true }));
	}, box3.y + box3.height / 2);

	const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
	expect(ops).toEqual([{ type: 'move-row', fromRowId: 'r_0', toRowId: 'r_2' }]);
});

test('Alt+Shift+ArrowRight moves the selected column one step right', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	// Select column A the same way cell-align.spec.ts does — a plain click.
	await page.locator('.bt-col-selector [data-idx="0"]').click();
	await expect(page.locator('.bt-cell-panel')).toBeVisible();

	await page.keyboard.press('Alt+Shift+ArrowRight');

	const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
	expect(ops).toEqual([{ type: 'move-col', fromColId: 'c_0', toColId: 'c_1' }]);
});

test('Alt+Shift+ArrowUp moves the selected row one step up', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	await page.locator('.bt-row-selector [data-idx="2"]').click();
	await expect(page.locator('.bt-cell-panel')).toBeVisible();

	await page.keyboard.press('Alt+Shift+ArrowUp');

	const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
	expect(ops).toEqual([{ type: 'move-row', fromRowId: 'r_1', toRowId: 'r_0' }]);
});

test('Alt+Shift+ArrowUp at row index 1 (adjacent to the header) does not move into the header', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);

	await page.locator('.bt-row-selector [data-idx="1"]').click();
	await expect(page.locator('.bt-cell-panel')).toBeVisible();

	await page.keyboard.press('Alt+Shift+ArrowUp');

	const ops = await page.evaluate(() => (window as unknown as { __btOps: unknown[] }).__btOps);
	expect(ops).toEqual([]);
});
