import { test, expect } from '../../common/test-base';

// Reported: double-clicking a narrow column's right edge to auto-fit its
// width did nothing. Root cause (autoFitColWidth/autoFitAllColWidths,
// renderAutofit.ts): the header cell's own filter-button icon carries a real
// <svg> (Obsidian's setIcon), and the per-cell classification checked for a
// "rendered diagram/embed" svg/canvas BEFORE checking the header's own
// .bt-th-text span — so for a header cell it measured the tiny filter icon
// instead of the actual header text, capping the "fit" at whatever the
// column already was. Never reproduced in this repo's own e2e suite before
// now because obsidian-shim.ts's setIcon() only set a data-icon attribute,
// never a real <svg> — fixed alongside this test.
const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: 一个很长的表头文字, width: 40 }
rows:
  - { id: r_0, cells: { c_0: "1" } }
  - { id: r_1, cells: { c_0: "2" } }
---
| 一个很长的表头文字 |
| --- |
| 1 |
| 2 |
`;

test('double-click auto-fit grows a narrow column to its header text width', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	const wrapper = page.locator('.bt-table-wrapper');
	const wb = (await wrapper.boundingBox())!;
	await page.mouse.move(wb.x + wb.width / 2, wb.y + 5);
	await page.waitForTimeout(300);

	const handle = page.locator('.bt-sel-resize-col').first();
	await handle.dblclick();

	const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string; width?: number }[] }).__btOps);
	const fitOp = ops.find(o => o.type === 'set-col-width');
	expect(fitOp, 'no set-col-width op was dispatched at all').toBeTruthy();
	expect(fitOp!.width, 'auto-fit should grow well past the narrow starting width to fit the header text').toBeGreaterThan(60);
});
