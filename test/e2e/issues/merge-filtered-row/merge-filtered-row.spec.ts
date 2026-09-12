import { test, expect } from '../../common/test-base';

// Reported: a column vertically merged across two rows, where another
// column's active filter hides the merge's ANCHOR row while the other row it
// spans survives. buildOccupied/getMergeOrigin only promoted a merge's
// effective anchor past a HIDDEN row (row.hidden) — never past a row hidden
// by a FILTER — so the surviving row's cell in that column was still marked
// "occupied" by a merge whose <tr> never rendered (the filtered row gets no
// <tr> at all). Net effect: the surviving row silently lost one whole <td>,
// shifting every later column in that row one slot to the left.
//
// C1 filters to only "C3": row 1 (C2) is filtered out, row 2 (C3) survives.
// A1 is merged across both rows.
const SOURCE = `---
version: 2
columns:
  - id: c_a
    name: A1
  - id: c_b
    name: B1
  - id: c_c
    name: C1
    filter: [C3]
rows:
  - id: r_1
    cells: { c_a: A23, c_b: B2, c_c: C2 }
  - id: r_2
    cells: { c_b: B3, c_c: C3 }
merges:
  - anchor: r_1.c_a
    end: r_2.c_a
---
`;

test('a merge whose anchor row is filtered out does not drop a cell from the surviving row', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	// The filtered-out row never gets a <tr>/cells at all.
	await expect(page.locator('[data-row="1"]')).toHaveCount(0);

	// The surviving row (display row 2) must keep all three columns.
	const surviving = page.locator('tr').filter({ has: page.locator('[data-row="2"]') });
	await expect(surviving.locator('td[data-row="2"]')).toHaveCount(3);

	const a1Cell = page.locator('td[data-row="2"][data-col="0"]');
	await expect(a1Cell).toHaveText('A23');
	// The DOM rowSpan property defaults to 1 when the attribute is absent —
	// either way, never 2: only one row of the merge's span actually survived.
	await expect.poll(() => a1Cell.evaluate(el => (el as HTMLTableCellElement).rowSpan)).toBe(1);
});
