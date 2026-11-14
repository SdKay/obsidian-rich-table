import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// The footer's text sits under the middle of the table, as the title's sits over it. The row an editable table keeps
// beside the table (the add-column strip, the room for the selectors) must not pull it sideways.
const mids = (page: import('@playwright/test').Page) => page.evaluate(() => {
	const mid = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return r.left + r.width / 2; };
	// The text itself, not its box: the box is as wide as the row, and the shift moves the text inside it.
	const range = document.createRange();
	range.selectNodeContents(document.querySelector('.bt-table-footer-line')!);
	const t = range.getBoundingClientRect();
	return { table: mid('table.bt-table'), text: t.left + t.width / 2 };
});

for (const locked of [false, true]) {
	test(`the footer is centred under the table (${locked ? 'locked' : 'editable'})`, { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [120, 120], rows: [{ 0: 'x', 1: 'y' }], footer: 'end note', locked }));
		await expect.poll(async () => { const m = await mids(page); return Math.abs(m.text - m.table); }).toBeLessThan(1);
	});
}

test('the footer stays centred under the table when the view is narrower than the table', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [200, 200, 200], rows: [{ 0: 'x' }], footer: 'end note', viewWidth: 300 }));
	await expect.poll(async () => { const m = await mids(page); return Math.abs(m.text - m.table); }).toBeLessThan(1);
});

test('the title and the footer are centred on the same line', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [120, 120], rows: [{ 0: 'x', 1: 'y' }], title: 'Heading', footer: 'end note' }));
	const [title, footer] = await page.evaluate(() => {
		const mid = (sel: string) => { const r = document.createRange(); r.selectNodeContents(document.querySelector(sel)!); const b = r.getBoundingClientRect(); return b.left + b.width / 2; };
		return [mid('.bt-table-title > span'), mid('.bt-table-footer-line')];
	});
	expect(Math.abs(title! - footer!)).toBeLessThan(1.5);
});
