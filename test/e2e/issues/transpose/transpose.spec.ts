import { test, expect } from '../../common/test-base';

const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: Name, width: 80 }
  - { id: c_1, name: Age, width: 80 }
rows:
  - { id: r_0, cells: { c_0: Alice, c_1: "30" } }
  - { id: r_1, cells: { c_0: Bob, c_1: "25" } }
---
`;

test('the transpose button promotes old column 0 to the new header', async ({ page, renderBlock }) => {
	const block = await renderBlock(SOURCE);
	await page.locator('table.bt-table').hover();
	await page.locator('.bt-ctrl-btn[aria-label="Transpose rows and columns"]').click();

	await expect.poll(async () => (await block.noteText()).includes('name: Age')).toBe(false);
	await block.reprocess();
	await expect.poll(() => page.locator('col').count()).toBe(3);

	const headerNames = await page.evaluate(() =>
		Array.from(document.querySelectorAll('th[data-row="0"]')).map(el => el.textContent?.trim()));
	expect(headerNames).toEqual(['Name', 'Alice', 'Bob']);

	const dataRow = await page.evaluate(() => {
		const row: string[] = [];
		for (let c = 0; c < 3; c++) {
			const el = document.querySelector(`[data-row="1"][data-col="${c}"]`);
			row.push(el?.textContent?.trim() ?? '');
		}
		return row;
	});
	expect(dataRow).toEqual(['Age', '30', '25']);
});

// A table produced by the header split/merge feature: a header-row
// horizontal merge over columns 0/1, a vertical merge on column 2 reaching
// the first data row, and a phantom column (c_an4of1) with no cell data of
// its own anywhere — it only ever
// shows content via the merges that wrap it.
const MERGED_SOURCE = `---
version: 2
columns:
  - id: c_9viik0
    name: "1"
    width: 40
  - id: c_an4of1
    name: ""
  - id: c_s1tb5i
    name: "2"
    width: 40
rows:
  - id: r_8s3lg0
    cells: {}
  - id: r_r8w7vw
    cells:
      c_9viik0: "3"
      c_s1tb5i: "4"
merges:
  - anchor: header.c_s1tb5i
    end: r_8s3lg0.c_s1tb5i
  - anchor: header.c_9viik0
    end: header.c_an4of1
  - anchor: r_r8w7vw.c_9viik0
    end: r_r8w7vw.c_an4of1
theme: grid
viewHeight: 147
---
`;

test('transposing a table with header/column-0 merges keeps every original value visible somewhere', async ({ page, renderBlock }) => {
	const block = await renderBlock(MERGED_SOURCE);
	await page.locator('table.bt-table').hover();
	await page.locator('.bt-ctrl-btn[aria-label="Transpose rows and columns"]').click();

	await expect.poll(async () => (await block.noteText()).includes('name: "2"')).toBe(false);
	await block.reprocess();
	await expect.poll(() => page.locator('col').count()).toBe(3);

	// Old column 0 ("1") is the new header; its own name becomes new column 0's name.
	const headerNames = await page.evaluate(() =>
		Array.from(document.querySelectorAll('th[data-row="0"]')).map(el => el.textContent?.trim()));
	expect(headerNames[0]).toBe('1');

	// Every original piece of text ("1", "2", "3", "4") is visible somewhere —
	// none of it silently disappears just because it crossed a merge boundary.
	const allText = await page.evaluate(() => document.querySelector('table.bt-table')!.textContent ?? '');
	for (const v of ['1', '2', '3', '4']) expect(allText).toContain(v);

	// All 3 merges survive, including the two with a corner in old column 0 —
	// that column became the new header, and a merge corner there lands on
	// the header (not dropped).
	const note = await block.noteText();
	expect(note.match(/anchor:/g) ?? []).toHaveLength(3);
});

// Same shape as MERGED_SOURCE, with one extra empty row (r_fhzbv1) between
// the two merge endpoints, and a second vertical merge confined to old
// column 0 alone (rows 0-1).
const MERGED_SOURCE_3ROW = `---
version: 2
columns:
  - id: c_9viik0
    name: "1"
    width: 40
  - id: c_an4of1
    name: ""
  - id: c_s1tb5i
    name: "2"
    width: 40
rows:
  - id: r_8s3lg0
    cells: {}
  - id: r_fhzbv1
    cells: {}
  - id: r_r8w7vw
    cells:
      c_9viik0: "3"
      c_s1tb5i: "4"
merges:
  - anchor: header.c_s1tb5i
    end: r_fhzbv1.c_s1tb5i
  - anchor: header.c_9viik0
    end: header.c_an4of1
  - anchor: r_r8w7vw.c_9viik0
    end: r_r8w7vw.c_an4of1
  - anchor: r_8s3lg0.c_9viik0
    end: r_fhzbv1.c_9viik0
theme: grid
viewHeight: 147
---
`;

test('transposing keeps every merge, including two both anchored in old column 0', async ({ page, renderBlock }) => {
	const block = await renderBlock(MERGED_SOURCE_3ROW);
	await page.locator('table.bt-table').hover();
	await page.locator('.bt-ctrl-btn[aria-label="Transpose rows and columns"]').click();

	await expect.poll(async () => (await block.noteText()).includes('name: "2"')).toBe(false);
	await block.reprocess();
	await expect.poll(() => page.locator('col').count()).toBe(4);

	const note = await block.noteText();
	expect(note.match(/anchor:/g) ?? []).toHaveLength(4);

	const allText = await page.evaluate(() => document.querySelector('table.bt-table')!.textContent ?? '');
	for (const v of ['1', '2', '3', '4']) expect(allText).toContain(v);
});
