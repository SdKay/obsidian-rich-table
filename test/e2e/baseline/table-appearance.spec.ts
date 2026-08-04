import { test, expect } from '../common/test-base';
import { expectLinesPainted, frameProfile, cellInkCounts, probeLines, expectNoLeakThroughFrozenBlock } from '../common/appearance-probe';
import { expectFrozenBlockInvariant, frozenBlockGeometry } from '../common/pixel-invariance';
import { BUILTIN_THEME_IDS } from '../../../src/themes';

/**
 * BASELINE APPEARANCE SUITE — not tied to any one reported issue.
 *
 * Every freeze bug reported so far has been a rendering defect that reads back
 * perfectly correct through computed style: the border-color, box-shadow and
 * background values were all exactly as intended while the table still looked
 * broken, because the defect was in WHERE things got painted. Per-issue tests
 * kept passing while the same class of bug came back in a new place.
 *
 * So this suite asserts appearance directly, from pixels, over the whole matrix
 * of (every built-in theme) × (freeze on / off) × (a spread of scroll offsets):
 *   1. every gridline the layout says should exist is actually painted
 *   2. turning freeze on doesn't change the table's outer frame
 *   3. cell content stays fully visible while scrolling (nothing covers it)
 *   4. the frozen block, being pinned, renders identically at every offset
 *
 * Line positions and cell rects come from the live DOM, so the suite adapts to
 * theme, zoom, font and column-width changes instead of hardcoding pixels.
 */

// Small enough to scroll on BOTH axes inside its own view box, and shaped like
// the tables these bugs actually surfaced on: explicit widths, a rowSpan+colSpan
// merge crossing the frozen boundary, and a per-cell background (which takes a
// different code path in renderFreeze's opaqueBg than the theme default).
const source = (extra: string) => `---
version: 2
columns:
  - { id: c_0, name: A, width: 54 }
  - { id: c_1, name: B, width: 44 }
  - { id: c_2, name: C, width: 44 }
  - { id: c_3, name: D, width: 44 }
  - { id: c_4, name: E, width: 44 }
  - { id: c_5, name: F, width: 44 }
  - { id: c_6, name: G, width: 44 }
  - { id: c_7, name: H, width: 44 }
rows:
  - { id: r_0, cells: { c_0: a1, c_2: c1, c_3: d1, c_5: f1, c_7: h1 } }
  - { id: r_1, cells: { c_0: a2, c_1: mm, c_4: e2, c_6: g2 } }
  - { id: r_2, cells: { c_0: a3, c_3: d3, c_5: f3 } }
  - { id: r_3, cells: { c_0: a4, c_2: c4, c_4: e4, c_7: h4 } }
  - { id: r_4, cells: { c_0: a5, c_1: b5, c_3: d5, c_6: g5 } }
  - { id: r_5, cells: { c_0: a6, c_2: c6, c_5: f6, c_7: h6 } }
merges:
  # Fully INSIDE the frozen block (rows idx 1-2 ≤ freezeRows 2, cols 0-1 <
  # freezeCols 2) and ending exactly ON both of its boundaries — the shape the
  # corruption bug needed. A merge that CROSSES a freeze boundary is rejected by
  # canFreezeRows/canFreezeCols, which silently disables freeze altogether; an
  # earlier version of this fixture did exactly that and the frozen-block test
  # was then measuring a region that legitimately scrolls.
  - { anchor: r_0.c_0, end: r_1.c_1 }
  # Fully OUTSIDE it, so the unfrozen path is covered too.
  - { anchor: r_3.c_3, end: r_4.c_4 }
styles:
  - { target: "r_4.c_0:r_4.c_1", bg: "#c39292" }
viewWidth: 190
viewHeight: 150
${extra}---
| A | B | C | D | E | F | G | H |
| --- | --- | --- | --- | --- | --- | --- | --- |
`;

const FROZEN = source('freezeRows: 2\nfreezeCols: 2\n');
// A spread of offsets, on both axes and diagonally: a sub-pixel defect can land
// on an exact device pixel at one offset and be invisible there, and the end
// stops (-1) exercise the clamped case a mid-range value never reaches.
const OFFSETS: [number, number][] = [[0, 0], [1, 0], [7, 0], [23, 0], [-1, 0], [0, 1], [0, 17], [0, -1], [23, 17], [-1, -1]];

// plain's header runs a keyframe animation, so its pixels legitimately differ
// between two screenshots taken microseconds apart. Pinning animations and
// transitions is what makes any pixel assertion meaningful on it — without this
// the ink/invariance checks fail on a theme that renders perfectly.
const PIN_ANIMATIONS = '*, *::before, *::after { animation: none !important; transition: none !important; }';

for (const theme of [undefined, ...BUILTIN_THEME_IDS]) {
	const label = theme ?? 'default (no theme)';
	const themed = (src: string) => theme ? src.replace('viewWidth:', `theme: ${theme}\nviewWidth:`) : src;

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(css => {
			window.addEventListener('DOMContentLoaded', () => {
				const s = document.createElement('style');
				s.textContent = css;
				document.head.appendChild(s);
			});
		}, PIN_ANIMATIONS);
	});

	test.describe(`appearance — ${label}`, () => {
		test('every gridline the layout expects is painted, unfrozen, at every scroll offset', async ({ page, renderReal }) => {
			await renderReal(themed(source('')));
			await expectLinesPainted(page, OFFSETS);
		});

		test('every gridline the layout expects is painted, frozen, at every scroll offset', async ({ page, renderReal }) => {
			await renderReal(themed(FROZEN));
			// Guard against a vacuous pass: if this theme draws cell borders at
			// all, the probe must have found some to check. Asked of the DOM rather
			// than hardcoded per theme, because most built-ins legitimately draw no
			// cell borders (base default is --bt-cell-border: none) and for those
			// "zero lines expected" is the correct answer, not a broken probe.
			const drawsBorders = await page.evaluate(() =>
				Array.from(document.querySelectorAll('.bt-table .bt-td')).some(c => {
					const cs = getComputedStyle(c);
					return cs.borderBottomStyle !== 'none' && parseFloat(cs.borderBottomWidth) > 0;
				}));
			const found = await probeLines(page);
			if (drawsBorders) expect(found.length, 'theme draws cell borders but the probe found none to check').toBeGreaterThan(20);
			await expectLinesPainted(page, OFFSETS);
		});

		test('turning freeze on does not change the table\'s outer frame', async ({ page, renderReal }) => {
			// Freeze suppresses the table's real top/left border and redraws it
			// synthetically. That substitution has to be invisible — and a frame
			// that's uniformly missing is invisible to every other check here.
			await renderReal(themed(source('')));
			const off = await frameProfile(page);
			await renderReal(themed(FROZEN));
			const on = await frameProfile(page);
			// Tolerance per sample, not exact: the synthetic line is a box-shadow
			// where the real one was a border, so antialiasing can differ slightly
			// on a fractional edge — but a missing line is a swing of 100+.
			// One-directional: freeze must never REMOVE a line the theme draws, but
			// it may ADD one where the theme draws none — for a theme with no outer
			// border at all, the frozen block still needs some edge against the
			// scrolling region, and renderFreeze deliberately falls back to a
			// generic divider there. Asserting plain equality flagged that
			// intentional behaviour on two themes.
			for (const edge of ['left', 'top'] as const) {
				const a = off[edge], b = on[edge];
				expect(b.length).toBe(a.length);
				const bg = Math.max(...a, ...b); // lightest sample ≈ the background
				const drawn = (v: number) => bg - v > 24;
				const lineUnfrozen = a.some(drawn), lineFrozen = b.some(drawn);
				if (lineUnfrozen) {
					expect(lineFrozen,
						`freeze REMOVED the theme's outer ${edge} frame: unfrozen=[${a.join(' ')}] frozen=[${b.join(' ')}]`)
						.toBe(true);
					// And in the same place, within a pixel — a frame that survives
					// but shifts is the 1px-drift bug wearing a different hat.
					const idx = (xs: number[]) => xs.reduce((best, v, i) => (v < xs[best]! ? i : best), 0);
					expect(Math.abs(idx(a) - idx(b)),
						`the outer ${edge} frame moved with freeze on: unfrozen=[${a.join(' ')}] frozen=[${b.join(' ')}]`)
						.toBeLessThanOrEqual(1);
				}
			}
		});

		test('cell content stays fully visible while scrolling', async ({ page, renderReal }) => {
			await renderReal(themed(FROZEN));
			// Ink = dark pixels inside a cell. A frozen cell's content can't change
			// as the table scrolls; if a neighbour's opaque background slides over
			// it (which is exactly what a sticky <tr> used to do to a rowSpan
			// merge), its ink drops.
			const rest = await cellInkCounts(page);
			expect(Object.keys(rest).length, 'no text-bearing frozen cells measured — fixture or probe is broken').toBeGreaterThan(3);
			for (const [left, top] of OFFSETS) {
				await page.evaluate(([l, t]) => {
					const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
					w.scrollLeft = l < 0 ? w.scrollWidth - w.clientWidth : l;
					w.scrollTop = t < 0 ? w.scrollHeight - w.clientHeight : t;
				}, [left, top]);
				await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
				const now = await cellInkCounts(page);
				for (const [id, cur] of Object.entries(now)) {
					const before = rest[id];
					if (before === undefined || before.ink < 8) continue; // wasn't measurable at rest
					// Only pinned along the axis that moved: a frozen-ROW cell in a
					// scrolling column is SUPPOSED to slide under the frozen columns
					// (losing ink) when scrolled horizontally, and vice versa. Only a
					// cell pinned on the moving axis has an invariant to check.
					if (left !== 0 && !cur.frozenCol) continue;
					if (top !== 0 && !cur.frozenRow) continue;
					expect(cur.ink, `cell ${id}'s content is partly covered at scrollLeft=${left}, scrollTop=${top} (${before.ink} ink px at rest, ${cur.ink} now)`)
						.toBeGreaterThan(before.ink * 0.75);
				}
			}
		});

		test('a bounded view stays scrollable on both axes', async ({ page, renderReal }) => {
			// The wrapper is the plugin's scroll container: base styles.css gives it
			// overflow:auto on purpose, and a frozen row's position:sticky has
			// nothing to stick against without it. A theme is not allowed to touch
			// layout properties (CLAUDE.md's theme contract) but nothing enforced
			// that mechanically — plain set overflow-y:hidden to get its rounded
			// corners and silently removed vertical scrolling entirely, reported as
			// "plain 主题下高度调小之后没有出现纵向滚动条". Asserted for every theme
			// so the next one can't reintroduce it, and on both axes so the mirror
			// mistake is covered too.
			await renderReal(themed(FROZEN));
			const box = await page.evaluate(() => {
				const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
				const cs = getComputedStyle(w);
				return {
					overflowX: cs.overflowX, overflowY: cs.overflowY,
					canScrollY: w.scrollHeight > w.clientHeight,
					canScrollX: w.scrollWidth > w.clientWidth,
				};
			});
			// The fixture is deliberately bigger than its own view box on both axes.
			expect(box.canScrollY, 'content is not taller than the view — fixture no longer tests this').toBe(true);
			expect(box.canScrollX, 'content is not wider than the view — fixture no longer tests this').toBe(true);
			// 'hidden' still scrolls programmatically, so a scrollLeft/scrollTop
			// check would pass while the user has no scrollbar and no wheel scroll.
			// The computed value is the thing that decides that, so assert on it.
			for (const axis of ['overflowX', 'overflowY'] as const) {
				expect(['auto', 'scroll', 'overlay']).toContain(box[axis]);
			}
		});

		test('nothing from the scrolling region shows through the frozen block', async ({ page, renderReal }) => {
			await renderReal(themed(FROZEN));
			await expectNoLeakThroughFrozenBlock(page, OFFSETS);
		});

		test('the frozen block renders identically at every scroll offset', async ({ page, renderReal }) => {
			await renderReal(themed(FROZEN));
			const geo = await frozenBlockGeometry(page);
			expect(geo.maxScrollLeft, 'fixture must scroll horizontally or this asserts nothing').toBeGreaterThan(0);
			expect(geo.maxScrollTop, 'fixture must scroll vertically or this asserts nothing').toBeGreaterThan(0);
			// A theme that rounds the TABLE's corners (plain: border-radius 12px)
			// has a known, accepted cosmetic difference here: the rounded corner
			// belongs to the <table>, so it scrolls away and the frozen block's own
			// square frame is what remains — the block's top-left corner is rounded
			// at rest and square once scrolled. Bounded to that corner's area (a
			// radius-sized square) so a real regression elsewhere still fails; the
			// allowance is derived from the DOM, not hardcoded to a theme name.
			// Read from every element that could be doing the clipping — plain puts
			// the radius on the wrapper (the scroll container), not the table.
			const radius = await page.evaluate(() => Math.max(
				...['.bt-table', '.bt-table-wrapper', '.bt-render-root'].map(sel => {
					const el = document.querySelector(sel);
					return el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0;
				})));
			await expectFrozenBlockInvariant(page, OFFSETS.filter(([l, t]) => l !== 0 || t !== 0), Math.ceil(radius * radius * 0.25));
		});
	});
}
