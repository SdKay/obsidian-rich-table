import { test, expect } from '../../common/test-base';

// A header cell merged across two columns grows with its text by the width the text needs, not by a
// whole column per keystroke.

const SRC = `---
version: 2
columns:
  - id: c_z85yhs
    name: GSPI 信号aa
  - id: c_5w3l1n
    name: GSPI
  - id: c_3lbhl6
    name: 应连接的 Pi 针脚
rows:
  - id: r_mq3vl4
    cells: {}
  - id: r_ghmp6t
    cells:
      c_z85yhs: SPI_CLK
      c_5w3l1n: 23（GPIO11）
      c_3lbhl6: PB19
merges:
  - anchor: header.c_3lbhl6
    end: r_mq3vl4.c_3lbhl6
  - anchor: header.c_z85yhs
    end: header.c_5w3l1n
theme: grid
---
`;

const widths = (page: import('@playwright/test').Page) => page.evaluate(() => {
	const w = (sel: string) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width;
	return { merged: w('th[data-row="0"][data-col="0"]'), second: w('col[data-col="1"]'), table: w('table.bt-table') };
});

const startEditing = async (page: import('@playwright/test').Page) => {
	await page.locator('th[data-row="0"][data-col="0"]').click();
	await page.keyboard.press('Enter');
	await page.locator('th[data-row="0"][data-col="0"] .bt-cell-editor').waitFor();
	await page.keyboard.press('End');
};

test('opening a merged header for edit does not widen it', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SRC);
	const rest = await widths(page);
	await startEditing(page);
	const editing = await widths(page);
	expect(editing.merged).toBeLessThanOrEqual(rest.merged + 2);
	expect(editing.table).toBeLessThanOrEqual(rest.table + 2);
});

test('typing and deleting in a merged header changes its width by about a character, not a column', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(SRC);
	await startEditing(page);
	const before = await widths(page);
	await page.keyboard.type('x');
	const typed = await widths(page);
	expect(typed.merged - before.merged).toBeLessThan(40);
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	const deleted = await widths(page);
	expect(deleted.merged).toBeLessThanOrEqual(typed.merged + 2);
	expect(deleted.second, 'the other column of the merge kept its width').toBeCloseTo(before.second, 0);
});
