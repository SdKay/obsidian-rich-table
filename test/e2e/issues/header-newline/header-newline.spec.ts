import { test, expect } from '../../common/test-base';

// A header name is stored as plain text; a line break typed with Shift+Enter has
// to show as a line break, as it does in a data cell.
const source = (cols: string) => `---
version: 2
columns:
${cols}
rows:
  - { id: r_0, cells: { c_0: x } }
---
`;

const heights = (page: import('@playwright/test').Page) => page.evaluate(() => {
	const text = (i: number) => document.querySelector(`th[data-row="0"][data-col="${i}"] .bt-th-text`) as HTMLElement;
	const lineH = parseFloat(getComputedStyle(text(1)).lineHeight) || text(1).getBoundingClientRect().height;
	return { multi: text(0).getBoundingClientRect().height, single: text(1).getBoundingClientRect().height, lineH };
});

test('a header name with a line break shows on two lines', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(source(`  - { id: c_0, name: "line1\\nline2", width: 140 }\n  - { id: c_1, name: "line1 line2", width: 140 }`));
	const h = await heights(page);
	expect(h.multi).toBeGreaterThan(h.single * 1.6);
});

test('a typed column keeps the line break too', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(source(`  - { id: c_0, name: "line1\\nline2", width: 140, type: date }\n  - { id: c_1, name: "line1 line2", width: 140, type: date }`));
	const h = await heights(page);
	expect(h.multi).toBeGreaterThan(h.single * 1.6);
});

test('auto-fit sizes the column to its longest line, not to both lines laid end to end', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(source(`  - { id: c_0, name: "abcdefghij\\nabcdefghij" }\n  - { id: c_1, name: "abcdefghij" }`));
	await page.evaluate(() => {
		const t = document.querySelector('table.bt-table') as HTMLElement;
		return t.offsetWidth;
	});
	const w = await page.evaluate(() => {
		const col = (i: number) => (document.querySelector(`th[data-row="0"][data-col="${i}"]`) as HTMLElement).getBoundingClientRect().width;
		return { multi: col(0), single: col(1) };
	});
	expect(w.multi, 'two lines of the same text must not make the column twice as wide').toBeLessThan(w.single * 1.3);
});
