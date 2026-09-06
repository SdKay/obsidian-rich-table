import { test, expect } from '../../common/test-base';

// A column with no explicit width yet (just split off, or just inserted)
// used to render at a flat 120px fallback regardless of how narrow its
// explicitly-sized neighbors were — reported as a new column looking
// jarringly wide next to two 40px-wide columns it was split out of. The new
// column has no content of its own to auto-fit to, so the fix falls back to
// colMinWidth (the same 40px floor auto-fit itself would land on for an
// empty, untyped column) instead of a flat 120.
const SPLIT_SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 40 }
  - { id: c_1, name: B, width: 40 }
rows:
  - { id: r_0, cells: { c_0: "3", c_1: "4" } }
---
`;

test('a column just created by split-cell-col renders at the auto-fit minimum, not a flat 120px', async ({ page, renderBlock }) => {
	const block = await renderBlock(SPLIT_SOURCE);
	await page.locator('[data-row="1"][data-col="0"]').dblclick();
	await page.locator('.bt-cp-item', { hasText: 'Split into 2 columns' }).click();
	await expect.poll(() => block.noteText()).toContain('merges:');
	await block.reprocess();
	await expect.poll(() => page.locator('col').count()).toBe(3);

	const widths = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	expect(widths).toEqual([40, 40, 40]);
});

const PLAIN_SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 40 }
rows:
  - { id: r_0, cells: { c_0: "1" } }
---
`;

test('a plain inserted column (no split involved) also renders at the auto-fit minimum, not 120px', async ({ page, renderBlock }) => {
	const block = await renderBlock(PLAIN_SOURCE);
	await page.locator('table.bt-table').hover();
	await page.locator('.bt-edge-add-col').click();
	await expect.poll(async () => ((await block.noteText()).match(/- id: c_/g) ?? []).length).toBe(2);
	await block.reprocess();
	await expect.poll(() => page.locator('col').count()).toBe(2);

	const widths = await page.evaluate(() => Array.from(document.querySelectorAll('col')).map(c => parseInt(c.style.width)));
	expect(widths[1]).toBe(40);
});
