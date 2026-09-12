import { test, expect } from '../../common/test-base';

// Reported: a row covered by a merge on the filtered column disappeared even
// though it visibly shows the exact value the filter allows — isRowFiltered
// compared each row's own RAW cell against the filter, and a covered cell's
// raw value is genuinely empty (the value it shows lives only on the merge's
// anchor). Fixed by resolving through the merge (resolveCellValue) before
// comparing against the filter.
//
// C1 filters to "C3". Row 1 (own C1 "C2") genuinely doesn't match and stays
// filtered out. Row 2 (own C1 "C3") matches. Row 3's own C1 is empty — it's
// merged with row 2's — so it must survive too, showing "C3" via the merge.
// A1 is merged across all three rows, exercising the "skip the filtered
// leading row, keep the later surviving rows" promotion at the same time.
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
  - id: r_3
    cells: { c_b: B4 }
merges:
  - anchor: r_1.c_a
    end: r_3.c_a
  - anchor: r_2.c_c
    end: r_3.c_c
---
`;

test('a row covered by a merge on the filtered column survives alongside its anchor', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	// Row 1 is genuinely filtered out — its own C1 doesn't match.
	await expect(page.locator('[data-row="1"]')).toHaveCount(0);

	// Rows 2 and 3 both survive: row 3's B1 cell must be visible even though
	// row 3 has no C1/A1 cell of its own (both covered by merges).
	await expect(page.locator('td[data-row="2"][data-col="1"]')).toHaveText('B3');
	await expect(page.locator('td[data-row="3"][data-col="1"]')).toHaveText('B4');

	// A1 spans exactly rows 2-3 (row 1 skipped, both survivors included).
	const a1Cell = page.locator('td[data-row="2"][data-col="0"]');
	await expect(a1Cell).toHaveText('A23');
	await expect.poll(() => a1Cell.evaluate(el => (el as HTMLTableCellElement).rowSpan)).toBe(2);

	// C1 spans rows 2-3 too (its own literal anchor/end, unaffected by the fix).
	const c1Cell = page.locator('td[data-row="2"][data-col="2"]');
	await expect(c1Cell).toHaveText('C3');
	await expect.poll(() => c1Cell.evaluate(el => (el as HTMLTableCellElement).rowSpan)).toBe(2);

	// Row 3 only renders its own (uncovered) B1 cell — A1/C1 there are covered
	// by the rowspans above, not separate <td>s.
	await expect(page.locator('td[data-row="3"]')).toHaveCount(1);
});
