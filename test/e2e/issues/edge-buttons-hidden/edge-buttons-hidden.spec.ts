import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: "行列增加按钮没了" — the hover-only add-row/add-col "+" strips
// stopped appearing at all once the status bar (FR-017) shipped. Root cause:
// positionEdgeStrips()'s "double-content guard" (renderer.ts) bails out
// whenever root's own height exceeds the wrapper's by more than a flat
// constant, as a defence against a genuinely anomalous double-stacked-root
// DOM state (the render-cache placeholder window). That constant was already
// tuned right up to the ceiling of what a plain table's own top strip-pad
// reservation could legitimately add — the status bar's ~23px pushed EVERY
// table (not just a title+footer edge case) over it. Covers the previously-
// tightest case (no title/footer at all) plus title+footer combinations.
async function isAddStripVisible(page: import('@playwright/test').Page, selector: string): Promise<boolean> {
	const wrapper = page.locator('.bt-table-wrapper');
	const wr = (await wrapper.boundingBox())!;
	await page.mouse.move(wr.x + wr.width / 2, wr.y + wr.height / 2);
	await page.waitForTimeout(400);
	return page.locator(selector).evaluate(el => el.classList.contains('bt-strip-visible'));
}

test('add-row/add-col strips become visible on hover: plain table (previously the tightest case)', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] }));
	expect(await isAddStripVisible(page, '.bt-edge-add-row')).toBe(true);
	expect(await isAddStripVisible(page, '.bt-edge-add-col')).toBe(true);
});

test('add-row strip becomes visible on hover: title + footer', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], title: 'My title', footer: 'My footer' }));
	expect(await isAddStripVisible(page, '.bt-edge-add-row')).toBe(true);
});

test('add-row strip becomes visible on hover: long title + long footer', async ({ page, renderFull }) => {
	await renderFull(tableSource({
		widths: [80, 80], rows: [{ 0: 'a1' }],
		title: 'A somewhat longer table title that could wrap onto two lines',
		footer: 'A somewhat longer footer note that could also wrap onto two or three lines depending on width',
	}));
	expect(await isAddStripVisible(page, '.bt-edge-add-row')).toBe(true);
});
