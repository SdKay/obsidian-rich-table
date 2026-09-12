import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: dragging the OUTER row's resize handle even slightly, for a row
// containing a nested rich-table, made the nested table's own rows suddenly
// balloon to a huge height. Root cause: --bt-row-height is set INLINE per
// cell (renderCell.ts) and consumed via `height: var(--bt-row-height, auto)`
// (styles.css) — custom properties inherit by default, and a nested table's
// entire DOM sits inside the outer cell that hosts it, so once the outer row
// got an explicit inline --bt-row-height (from the drag), every one of the
// nested table's own "auto" rows inherited THAT value instead of falling
// back to auto — and a table cell's `height` acts as a per-row minimum, so
// every nested row tried to be that tall independently (N rows × the outer's
// one explicit height, not just a mildly-wrong number).
//
// Fixed with a single, universal CSS rule (.bt-render-root resets --bt-row-
// height/--bt-cell-font-size to `initial`) — applies identically to every
// table, nested or not; nothing here is nested-aware. Simulates the nested
// render (this harness's MarkdownRenderer stub can't produce a real one) by
// injecting the same DOM shape a real nested table would have.
const SOURCE = tableSource({ widths: [200], rows: [{ 0: 'x' }] });

test("a nested table's own cell does not inherit the outer row's explicit --bt-row-height", async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	await page.evaluate(() => {
		const outerCell = document.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!;
		// Simulates what dragging the outer row's resize handle does —
		// renderCell.ts sets this same custom property inline, per cell.
		outerCell.style.setProperty('--bt-row-height', '400px');

		outerCell.innerHTML = '';
		const root = document.createElement('div');
		root.className = 'bt-render-root';
		const wrapper = document.createElement('div');
		wrapper.className = 'bt-table-wrapper';
		const nestedTable = document.createElement('table');
		nestedTable.className = 'bt-table';
		const nestedTd = document.createElement('td');
		nestedTd.className = 'bt-td';
		// No --bt-row-height of its own — this nested cell's row is "auto",
		// the common case (never explicitly resized).
		nestedTable.appendChild(nestedTd);
		wrapper.appendChild(nestedTable);
		root.appendChild(wrapper);
		outerCell.appendChild(root);
	});

	const nestedRowHeightVar = await page.locator('.bt-render-root .bt-render-root .bt-td').evaluate(el =>
		getComputedStyle(el).getPropertyValue('--bt-row-height').trim());
	expect(nestedRowHeightVar, "must not inherit the outer cell's explicit height").not.toBe('400px');

	// The outer cell's OWN --bt-row-height must still apply to ITSELF —
	// this fix must not accidentally break the feature it's built for.
	const outerRowHeightVar = await page.locator('[data-row="1"][data-col="0"]').evaluate(el =>
		getComputedStyle(el).getPropertyValue('--bt-row-height').trim());
	expect(outerRowHeightVar).toBe('400px');
});
