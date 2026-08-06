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

// The row/column selector strips can't be rendered by this harness (they're
// built by renderTable, which needs Obsidian's App/MarkdownRenderer), so the
// closest thing to covering them is to pin the GEOMETRY CONTRACT they depend on:
// every strip element — a column's label, its drag grip, and the hover zone that
// resizes it — is positioned from scrollContentOffset, the same function the
// frozen cells' sticky offsets come from. Reported bug: the resize hover zone
// for a frozen column sat outside the strip, along the extension of the boundary
// line it drags, because the strips accumulated widths from zero (omitting the
// table's own border) while the frozen cells measured properly. A comment in
// renderer.ts even claimed the two were "the same offset … just reusing the
// existing one" — they never were, only coincidentally equal.
test.describe('freeze geometry contract (what the selector strips are positioned from)', () => {
	test('a frozen column\'s measured offset is where its cell actually comes to rest', async ({ page, renderReal }) => {
		await renderReal(SOURCE, { scrollLeft: 137 });
		const rows = await page.evaluate(() => {
			const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
			const cs = getComputedStyle(wrapper);
			const origin = wrapper.getBoundingClientRect().x + (parseFloat(cs.borderLeftWidth) || 0);
			return Array.from(document.querySelectorAll<HTMLElement>('#table col'))
				.filter(c => c.dataset.col !== undefined && parseInt(c.dataset.col) < 3)
				.map(c => {
					const ci = parseInt(c.dataset.col!);
					const cell = document.querySelector<HTMLElement>(`#table th[data-col="${ci}"]`)!;
					const rect = cell.getBoundingClientRect();
					return {
						ci,
						// What the strips use to place a label / grip / resize handle.
						measuredLeft: window.RichTableReal.scrollContentOffset(c, 'x'),
						measuredRight: window.RichTableReal.scrollContentOffset(c, 'x') + c.getBoundingClientRect().width,
						// Where the frozen cell has actually come to rest on screen.
						restLeft: rect.left - origin,
						restRight: rect.right - origin,
					};
				});
		});
		expect(rows.length).toBe(3);
		for (const r of rows) {
			// Sub-pixel tolerance only: a whole pixel out is exactly the failure that
			// put the resize zone off its own boundary line.
			expect(Math.abs(r.measuredLeft - r.restLeft), `column ${r.ci}: strips would place elements at ${r.measuredLeft}, cell rests at ${r.restLeft}`).toBeLessThan(0.5);
			expect(Math.abs(r.measuredRight - r.restRight), `column ${r.ci}: the resize seam would land at ${r.measuredRight}, the cell's real right edge is ${r.restRight}`).toBeLessThan(0.5);
		}
	});

	test('an accumulator from zero would NOT satisfy that contract', async ({ page, renderReal }) => {
		await renderReal(SOURCE, { scrollLeft: 137 });
		// Guards the fix from being "simplified" back: this reproduces the old
		// accumulate-from-zero basis and asserts it disagrees with reality, so the
		// test above is demonstrably measuring something rather than comparing two
		// spellings of the same expression.
		const drift = await page.evaluate(() => {
			const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
			const cs = getComputedStyle(wrapper);
			const origin = wrapper.getBoundingClientRect().x + (parseFloat(cs.borderLeftWidth) || 0);
			let acc = 0;
			let worst = 0;
			for (const c of Array.from(document.querySelectorAll<HTMLElement>('#table col'))) {
				const ci = c.dataset.col !== undefined ? parseInt(c.dataset.col) : undefined;
				if (ci !== undefined && ci < 3) {
					const cell = document.querySelector<HTMLElement>(`#table th[data-col="${ci}"]`)!;
					worst = Math.max(worst, Math.abs(acc - (cell.getBoundingClientRect().left - origin)));
				}
				acc += parseFloat(c.style.width) || 0;
			}
			return worst;
		});
		expect(drift, 'the old basis happens to agree here, so the contract test above proves nothing on this fixture').toBeGreaterThanOrEqual(1);
	});
});
