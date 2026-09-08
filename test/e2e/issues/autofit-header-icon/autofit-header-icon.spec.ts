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
//
// Double-click's own behaviour later changed (see choice-col-reactive-width
// and header-type-caret's own notes): it now CLEARS the column's width
// rather than writing a computed number, so the column tracks its own
// content going forward instead of being pinned to a one-off fit. Needs
// renderBlock (not renderFull), since only that fixture actually reprocesses
// the note after an op — renderFull's __btOps never feeds back into the DOM.
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

test('double-click auto-fit grows a narrow column to its header text width', async ({ page, renderBlock }) => {
	const block = await renderBlock(SOURCE);
	const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
	const wb = (await wrapper.boundingBox())!;
	await page.mouse.move(wb.x + wb.width / 2, wb.y + 5);
	await page.waitForTimeout(300);

	const handle = page.locator('.bt-sel-resize-col').first();
	await handle.dblclick();

	// This is the ONLY column, so clearing its width drops the table back to
	// no explicit widths at all — `width:` disappears from the note entirely.
	await expect.poll(() => block.noteText()).not.toContain('width:');
	await block.reprocess();

	// reprocess() doesn't itself wait for the rebuild to finish (every other
	// reprocess()-using test in this suite polls a real signal afterward
	// before reading further state) — poll on the actual rendered width
	// rather than reading it once immediately after reprocess() returns.
	const colWidth = () => page.locator('col[data-col="0"]').evaluate(el => (el as HTMLElement).getBoundingClientRect().width);
	await expect.poll(colWidth, 'auto-fit should grow well past the narrow starting width to fit the header text').toBeGreaterThan(60);
});
