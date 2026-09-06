import { test, expect } from '../../common/test-base';

// rowspan cannot cross a <thead>/<tbody> boundary — confirmed by direct
// measurement: an identical merge entirely within <tbody> renders at its full
// height, but the exact same merge anchored at the header used to collapse to
// just the header's own row height, because <thead> and <tbody> are
// independent row groups as far as the table layout algorithm is concerned.
// Fixed by hosting whichever data row(s) a header-anchored merge reaches into
// inside <thead> too (computeHeaderRowSpan, renderGridHelpers.ts) — reported
// as a column that visually "broke" (its other, unmerged column's split-off
// row showed as a strangely thin sliver next to it) after splitting a header
// cell.
const SOURCE = `---
version: 2
columns:
  - id: c_0
    name: "1"
    width: 40
  - id: c_1
    name: "2"
    width: 40
rows:
  - id: r_0
    cells: {}
  - id: r_1
    cells:
      c_0: "3"
      c_1: "4"
merges:
  - anchor: header.c_1
    end: r_0.c_1
---`;

test('a header-anchored merge reaching into a data row renders at its full, uncollapsed height', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const headerCell = page.locator('[data-row="0"][data-col="1"]');
	await expect(headerCell).toHaveAttribute('rowspan', '2');

	const headerHeight = (await headerCell.boundingBox())!.height;
	const siblingCellHeight = (await page.locator('[data-row="0"][data-col="0"]').boundingBox())!.height;
	const newRowCellHeight = (await page.locator('[data-row="1"][data-col="0"]').boundingBox())!.height;

	// The merged cell must cover the header's own row PLUS the row it reaches
	// into — not collapse to just the header's row height (the bug's exact
	// symptom: rowspan="2" present in the DOM, but rendered no taller than
	// rowspan="1" would have).
	expect(headerHeight, 'the header cell collapsed to one row instead of spanning both')
		.toBeGreaterThan(siblingCellHeight + newRowCellHeight - 2); // small AA tolerance

	// And the row it reaches into is genuinely hosted in <thead>, which is
	// WHY the rowspan renders correctly at all (same row group as the anchor).
	const newRowParent = await page.locator('[data-row="1"][data-col="0"]').evaluate(
		(el: HTMLElement) => el.closest('tr')!.parentElement!.tagName);
	expect(newRowParent).toBe('THEAD');
});
