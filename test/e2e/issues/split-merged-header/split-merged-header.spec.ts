import { test, expect } from '../../common/test-base';

// "Split into 2 rows" on a header cell that spans several columns: the menu
// offers it, so choosing it has to do something.
const SOURCE = `---
version: 2
columns:
  - id: c_nkcerp
    name: pi5
  - id: c_qfb959
    name: ""
  - id: c_yo9r60
    name: dplus
rows:
  - id: r_2hj92j
    cells: {}
merges:
  - anchor: header.c_nkcerp
    end: header.c_qfb959
theme: grid
---
`;

test('double-clicking a merged header cell and splitting it into 2 rows adds the row', async ({ page, renderBlock }) => {
	const block = await renderBlock(SOURCE);
	const before = await page.locator('.bt-table tr').count();

	await page.locator('th[data-row="0"][data-col="0"]').dblclick();
	await page.locator('.bt-cell-panel .bt-cp-item', { hasText: 'Split into 2 rows' }).click();

	await expect.poll(() => block.noteText()).toMatch(/anchor: r_\w+\.c_nkcerp/);
	const note = await block.noteText();
	expect(note).toMatch(/anchor: header\.c_nkcerp\s+end: header\.c_qfb959/);
	expect(note).toMatch(/anchor: header\.c_yo9r60\s+end: r_\w+\.c_yo9r60/);
	await block.reprocess();
	await expect.poll(() => page.locator('.bt-table tr').count()).toBe(before + 1);
});
