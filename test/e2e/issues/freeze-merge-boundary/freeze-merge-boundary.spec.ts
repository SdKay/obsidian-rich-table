import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// A merged cell exists in the DOM only at its ANCHOR position — the rows and
// columns it covers have no element there at all. So an anchor-only test for
// "does this cell's edge land on the frozen boundary" misses any merge anchored
// before the boundary and spanning into it, and such a merge silently never got
// the boundary treatment. Reported as a line missing at exactly that merge's
// edge, with nothing there to occlude the scrolling content either.
//
// The condition has to be `anchorIndex + span - 1 === boundary` on BOTH axes;
// this is the focused test for that, with the merge deliberately placed so its
// anchor is inside the band and its true edges land exactly on both boundaries.
//
// Rewritten against the REAL source — the hand-ported version asserted the
// INVERSE of current behaviour (that the boundary edge gets hidden and replaced
// by a synthetic line) and still passed, because the assertions ran against its
// own inlined copy of the old algorithm rather than against the plugin.
test.describe('freeze-merge-boundary', () => {
	// freezeRows 2 → rows 0..2 frozen (header + 2 data rows); freezeCols 2 →
	// columns 0..1. The merge is anchored at data row 0 / column 0 and spans 2x2,
	// so its true bottom edge is row 2 (=== freezeRows) and its true right edge
	// is column 1 (=== freezeCols - 1) while NEITHER anchor index is.
	const SOURCE = scrollableTable({
		freezeRows: 2, freezeCols: 2, theme: 'grid',
		merges: [[0, 0, 1, 1]],
	});

	test('a merge spanning into the boundary is recognised on both axes', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		const merged = page.locator('#table td[data-row="1"][data-col="0"]');
		await expect(merged).toHaveCount(1);
		const info = await merged.evaluate(el => {
			const cell = el as HTMLTableCellElement;
			const cs = getComputedStyle(el);
			return { rowSpan: cell.rowSpan, colSpan: cell.colSpan, shadow: cs.boxShadow, zIndex: cs.zIndex };
		});
		expect(info.rowSpan).toBe(2);
		expect(info.colSpan).toBe(2);
		// Frozen on both axes → the top z tier, so no scrolling neighbour can
		// paint over it from either direction.
		expect(info.zIndex).toBe('4');
		// And it carries the elevation shadow for both seams it sits on. Two
		// distinct inset layers rather than one: the row seam casts downward and
		// the column seam rightward, and a merge on both gets both.
		const layers = info.shadow.split(/,(?![^(]*\))/).filter(l => l.includes('inset'));
		expect(layers.length, `expected both seams' shadows, got: ${info.shadow}`).toBeGreaterThanOrEqual(2);
	});

	test('the boundary edge keeps the theme\'s own border rather than a synthetic line', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		const info = await page.locator('#table td[data-row="1"][data-col="0"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { bottom: cs.borderBottomColor, right: cs.borderRightColor };
		});
		// Suppressing these and drawing a generic replacement was itself the later
		// bug: it swapped grid's near-black rule for a pale grey one, one pixel out
		// of place, which read as the line having gone missing.
		expect(info.bottom).toBe('rgb(17, 17, 17)');
		expect(info.right).toBe('rgb(17, 17, 17)');
	});

	test('a merge that does NOT reach the boundary gets no seam treatment', async ({ page, renderReal }) => {
		// Same shape, but the merge stops one row and one column short, so neither
		// of its true edges is a boundary. Guards the condition from the other
		// side — an over-eager check would light this one up too.
		await renderReal(scrollableTable({
			freezeRows: 3, freezeCols: 3, theme: 'grid',
			merges: [[0, 0, 1, 1]],
		}));
		const shadow = await page.locator('#table td[data-row="1"][data-col="0"]').evaluate(el => getComputedStyle(el).boxShadow);
		// Not "no shadow at all": sitting in column 0 this cell still carries the
		// block's outer LEFT frame line, which is unrelated to the seam. The seam's
		// elevation shadows are the inset ones, so that's what must be absent.
		expect(shadow).not.toContain('inset');
	});
});
