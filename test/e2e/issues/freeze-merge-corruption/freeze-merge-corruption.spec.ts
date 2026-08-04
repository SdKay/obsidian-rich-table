import { test, expect } from '../../common/test-base';
import { expectFrozenBlockInvariant, frozenBlockGeometry } from '../../common/pixel-invariance';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(__dirname, 'source.yaml'), 'utf8');
// Same table, same freeze counts, same merge, same theme — only more rows and a
// shorter view, so the wrapper actually scrolls VERTICALLY too. The original
// fixture's content is shorter than its own viewHeight (maxScrollTop === 0), so
// on its own it can only ever exercise the horizontal axis; without this variant
// the row axis of every fix below would be completely untested.
const SOURCE_TALL = fs.readFileSync(path.join(__dirname, 'source-tall.yaml'), 'utf8');

// Regression test for a real user-reported table (tmp/bad.png, source extracted
// verbatim into source.yaml from the vault's tmp/rich-table-test.md):
// freezeRows: 3, freezeCols: 3, grid theme, and a merge (anchor
// r_qcqtr0.c_ebi8n7, end r_7gk8ac.c_ho9vd2 — rows 2-3, cols 1-2) whose true
// bottom AND right edges both land exactly on the frozen block's boundary,
// making it the one cell in the table frozen along both axes at that corner.
//
// Reported symptoms, all three during horizontal scroll only — the block
// rendered perfectly at rest, which is why this survived several rounds of
// computed-style-based fixes:
//   1. the frozen block's column separators disappeared entirely
//   2. the merged cell's text ("aaa") was half covered
//   3. the block's bottom seam was drawn at only half length
//
// Root causes — three separate, ordinary bugs in this codebase, none of them the
// Chromium compositing defect they were originally attributed to:
//   1. --bt-frozen-left/-top accumulated from 0, ignoring that the first
//      row/column starts INSIDE the table's own border → the whole block shifted
//      1px the moment it stuck (renderFreeze.ts's scrollOffset)
//   2. border-collapse: collapse makes a shared edge the TABLE's to paint, at
//      layout position, so it can't follow a sticky cell → the block's own
//      gridlines scrolled away (styles.css: border-collapse: separate)
//   3. position:sticky creates a stacking context unconditionally, so a sticky
//      <tr> painted as one unit over the rowSpan cell reaching into it from the
//      row above (styles.css: per-cell sticky for row-freeze)
test.describe('freeze-merge-corruption', () => {
	test('the merged cell (rows 2-3, cols 1-2) is treated as the frozen block\'s corner on both axes', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		const merged = page.locator('td[data-row="2"][data-col="1"]');
		await expect(merged).toHaveCount(1);
		const info = await merged.evaluate(el => {
			const cs = getComputedStyle(el);
			return {
				rowSpan: (el as HTMLTableCellElement).rowSpan,
				colSpan: (el as HTMLTableCellElement).colSpan,
				boxShadow: cs.boxShadow, backgroundColor: cs.backgroundColor,
				position: cs.position, zIndex: cs.zIndex, top: cs.top, left: cs.left,
			};
		});
		// row 2 + rowSpan 2 - 1 = 3 = freezeRows, and col 1 + colSpan 2 - 1 = 2 =
		// freezeCols - 1: this cell's TRUE edges are the block's boundary even
		// though its anchor indices aren't, which is what anchor-only checks missed.
		expect(info.rowSpan).toBe(2);
		expect(info.colSpan).toBe(2);
		// Frozen on both axes: sticky with BOTH offsets resolved, and in the top
		// z tier so no scrolling neighbour can paint over it from either side.
		expect(info.position).toBe('sticky');
		expect(info.top).not.toBe('auto');
		expect(info.left).not.toBe('auto');
		expect(info.zIndex).toBe('4');
		// Opaque (nothing bleeds through) and carrying its seam/elevation shadow.
		expect(info.boxShadow).not.toBe('none');
		expect(info.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
	});

	test('row-freeze stickies each cell, not the <tr>', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		// A sticky <tr> is an atomic paint unit (position:sticky always creates a
		// stacking context), which is what let a later frozen row cover the row
		// above's rowSpan cell. Guard the mechanism directly, not only its symptom:
		// the symptom needs a merge in exactly the right place to appear, so a
		// future refactor could reintroduce this and slip past the pixel tests on
		// any table that happens to have no such merge.
		const stickyRows = await page.locator('#table tr').evaluateAll(
			rows => rows.filter(r => getComputedStyle(r).position === 'sticky').length);
		expect(stickyRows).toBe(0);
		const stickyCells = await page.locator('#table .bt-frozen-row').evaluateAll(
			cells => cells.filter(c => getComputedStyle(c).position === 'sticky').length);
		expect(stickyCells).toBeGreaterThan(0);
	});

	test('frozen cells come to rest exactly where the table lays them out', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		// The 1px-shift bug, asserted numerically rather than visually: a frozen
		// cell's on-screen x must be the same stuck as unstuck. An accumulator
		// starting at 0 (the old --bt-frozen-left) is off by whatever sits in
		// front of the first column — 1px under grid's 2px frame.
		const drift = await page.evaluate(() => {
			const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
			const read = () => Array.from(document.querySelectorAll('#table th[data-col]'))
				.slice(0, 3).map(c => c.getBoundingClientRect().x);
			wrapper.scrollLeft = 0;
			const rest = read();
			wrapper.scrollLeft = 300;
			const stuck = read();
			wrapper.scrollLeft = 0;
			return rest.map((x, i) => Math.abs((stuck[i] ?? 0) - x));
		});
		for (const d of drift) expect(d).toBeLessThan(0.5);
	});

	test('the frozen block renders identically at every horizontal scroll offset', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		const geo = await frozenBlockGeometry(page);
		expect(geo.maxScrollLeft, 'fixture must actually scroll horizontally or this asserts nothing').toBeGreaterThan(0);
		// A spread of offsets, not one: a sub-pixel bug can land on an exact
		// device pixel at some offsets and be invisible there. -1 = the end stop.
		await expectFrozenBlockInvariant(page, [[1, 0], [3, 0], [7, 0], [17, 0], [30, 0], [60, 0], [137, 0], [-1, 0]]);
	});

	test('the frozen block renders identically at every vertical and diagonal scroll offset', async ({ page, renderReal }) => {
		await renderReal(SOURCE_TALL);
		const geo = await frozenBlockGeometry(page);
		expect(geo.maxScrollTop, 'tall fixture must actually scroll vertically or this asserts nothing').toBeGreaterThan(0);
		await expectFrozenBlockInvariant(page, [
			[0, 1], [0, 9], [0, 40], [0, -1],
			[60, 40], [137, 9], [-1, -1],
		]);
	});
});
