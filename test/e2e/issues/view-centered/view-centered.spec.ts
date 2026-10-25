import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';
import type { Page } from '@playwright/test';

// The status bar has a minimum width. When the table is narrower than that, the
// view widens to hold the bar; it must widen evenly on both sides so the body
// stays centered inside the view (a freshly created blank table is the common
// case: every column is auto and narrow).
const gaps = (page: Page) => page.evaluate(() => {
	const shell = [...document.querySelectorAll('.bt-render-root-shell')].find(s => s.querySelector('.bt-table-wrapper'))!;
	const R = (sel: string) => shell.querySelector(sel)!.getBoundingClientRect();
	const frame = R('.bt-outer-frame'), body = R('table.bt-table'), bar = R('.bt-status-bar');
	return { left: body.left - frame.left, right: frame.right - body.right, barL: bar.left - frame.left, barR: frame.right - bar.right };
});

for (const cols of [2, 3, 4, 8]) {
	test(`a blank ${cols}-column table is centered in its view`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		const widths = Array(cols).fill(0);
		const row = Object.fromEntries(widths.map((_, i) => [i, '']));
		await renderFull(tableSource({ widths, rows: [row, row] }));
		await page.waitForTimeout(600);
		const g = await gaps(page);
		expect(Math.abs(g.left - g.right), JSON.stringify(g)).toBeLessThanOrEqual(1);
		expect(Math.abs(g.barL), 'status bar shares the view\'s left edge').toBeLessThanOrEqual(1);
		expect(Math.abs(g.barR), 'status bar shares the view\'s right edge').toBeLessThanOrEqual(1);
	});
}

test('a table already wider than the status bar keeps its symmetric gaps', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [90, 90, 90, 90, 90, 90], rows: [{ 0: 'x' }] }));
	await page.waitForTimeout(600);
	const g = await gaps(page);
	expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1);
});
