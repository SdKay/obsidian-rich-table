import type { TableModelV2 } from './model';
import { canFreezeRows, canFreezeCols } from './operations';
import { cellEffectiveStyle } from './renderCellStyle';

/**
 * Applies sticky positioning for frozen rows/columns (`model.freezeRows`/
 * `freezeCols`) — called from a rAF-coalesced ResizeObserver on `table`
 * (renderer.ts) on every geometry-affecting change (edit, resize, zoom),
 * since row heights and column widths can both change at any time and the
 * sticky offsets have to track them live.
 *
 * Re-validates against canFreezeRows/canFreezeCols rather than trusting the
 * stored value outright — every path that SETS freezeRows/freezeCols already
 * goes through that same check (see operations.ts), so this only matters for
 * a hand-edited YAML file.
 *
 * Both axes stick per CELL. Sticking the whole <tr> for row-freeze looks like a
 * free win (one sticky point per row instead of N) and is how this worked until
 * a measured bug ruled it out: position:sticky creates a stacking context
 * unconditionally, so a sticky <tr> is an atomic paint unit that covers any
 * rowSpan cell reaching into it from the row above. See the ROW-FREEZE STICKS
 * EACH CELL note in styles.css. Column-freeze was always per-cell anyway (<col>
 * elements can't be positioned), so both axes are now consistent.
 *
 * VISUAL MODEL (deliberately simple, after a long dead end): the frozen
 * region is drawn as a plain opaque block with a single clean frame — it does
 * NOT try to reproduce whatever internal gridlines the active theme draws.
 * The earlier approach (read each cell's own border/box-shadow via
 * getComputedStyle and replicate it per cell so the frozen region looked
 * byte-identical to the scrolling region) was abandoned as fundamentally
 * fragile: themes draw their decoration in mutually-incompatible ways (grid
 * via real borders on cells, academic via box-shadow on cells AND on <tbody>,
 * others potentially via pseudo-elements), on different elements, and
 * fractional device-pixel widths from a non-100% zoom level made exact
 * replication impossible — every theme and every zoom surfaced a new gap.
 * Confirmed via logging that the per-cell inline styles WERE winning the
 * cascade (inline == computed, priority important), so the failures were not
 * a specificity problem at all; the whole "replicate the theme" goal was the
 * wrong target. Instead every frozen cell now gets:
 *   - its own real borders suppressed (no flaky border-collapse lines on a
 *     sticky cell), and
 *   - an opaque background (so scrolling content can't show through), and
 *   - NO internal line;
 * and only the frozen block's outer frame + the seam against the scrolling
 * region get a synthetic box-shadow line (theme-neutral, via Obsidian's own
 * --background-modifier-border, overridable through --bt-frozen-divider) plus
 * an elevation shadow at the seam so the block reads as "floating above" the
 * scrolling content. This can never be broken by a theme's own decoration,
 * because it reads nothing from the theme. All overrides are inline with
 * 'important' priority (forceImportant) — the same "inline beats any
 * stylesheet rule's !important regardless of specificity" guarantee this
 * codebase already relies on for user per-cell styles (applyResolvedStyle).
 */
function forceImportant(el: HTMLElement, prop: string, value: string): void {
	el.style.setProperty(prop, value, 'important');
}

// box-shadow is one property, so multiple synthetic lines on the same cell
// (e.g. the top-left corner cell needs top + left; the frozen block's
// bottom-right corner needs bottom + right + elevation) have to be composed
// into one comma-separated value. The running value is stashed in a scratch
// custom property so successive calls can append to it, and re-applied inline
// with 'important' each time.
function addBoxShadow(cell: HTMLElement, layer: string): void {
	const existing = cell.style.getPropertyValue('--bt-frozen-box-shadow-scratch');
	const combined = existing ? `${existing}, ${layer}` : layer;
	cell.style.setProperty('--bt-frozen-box-shadow-scratch', combined);
	forceImportant(cell, 'box-shadow', combined);
}

// The frame/seam line — theme-neutral on purpose (see the VISUAL MODEL note).
// A user/theme can still restyle it via --bt-frozen-divider without touching
// any selector, same pattern as the other --bt-* quick-customize variables.
const LINE = 'var(--bt-frozen-divider, var(--background-modifier-border))';

// A theme may draw its OWN horizontal/vertical rules as a box-shadow directly
// on a cell (academic.css's toprule/midrule do this on the header cells).
// Since box-shadow is a single property, blindly setting our own frame lines
// would REPLACE that decoration outright (confirmed: academic's top line
// vanished on exactly the frozen columns where we drew a vertical frame line,
// while the middle column that got no frame line kept it). So before adding
// any of our own layers, read the cell's already-cascaded box-shadow and seed
// the accumulator with it — our lines then compose on top instead of erasing
// it. Must run before the cell's box-shadow is first written this pass (the
// scratch guard makes it a no-op on the second axis for a corner cell that's
// both row- and column-frozen), and after clearCell has removed any prior
// inline box-shadow (so getComputedStyle returns the theme's value, not last
// pass's synthetic one).
function seedThemeShadow(cell: HTMLElement): void {
	if (cell.style.getPropertyValue('--bt-frozen-box-shadow-scratch')) return;
	const themed = getComputedStyle(cell).boxShadow;
	if (themed && themed !== 'none') {
		cell.style.setProperty('--bt-frozen-box-shadow-scratch', themed);
		forceImportant(cell, 'box-shadow', themed);
	}
}

// customBg (a user's own per-cell/row/col background, resolved via
// cellEffectiveStyle) takes priority over the generic frozen fill — reported:
// a background color set on a cell inside the frozen region never showed up.
// Root cause: applyResolvedStyle (renderCellStyle.ts) and this function both
// set `background-color` inline with 'important' priority, and this function
// re-runs on every freeze pass (any geometry change), always AFTER the cell's
// own style was applied — so it unconditionally overwrote the user's color
// with the frozen-region default every time. opaqueBg's job is to guarantee
// SOME opaque color is there (so scrolling content can't bleed through), not
// to pick WHICH one — if the user already chose one, that's the color to make
// opaque, not the theme default.
function opaqueBg(cell: HTMLElement, customBg?: string | null): void {
	// Aggregate rows already have their own opaque, visually-distinct
	// background — leave it, don't flatten it to the generic frozen fill.
	if (cell.hasClass('bt-agg-td')) return;
	if (customBg) { forceImportant(cell, 'background-color', customBg); return; }
	const isHeader = cell.tagName === 'TH';
	forceImportant(cell, 'background-color', isHeader
		? 'var(--bt-frozen-header-bg, var(--background-secondary))'
		: 'var(--bt-frozen-bg, var(--background-primary))');
}

// Hide a cell border by making it transparent, NOT by removing it. `border:
// none` would drop the theme's border WIDTH, shrinking the cell → changing
// the table's rendered size → re-triggering the ResizeObserver that runs
// applyFreeze → which changes borders again … a layout feedback loop. On its
// own it self-terminates in ~2 frames, but during a drag/hover the selector
// strip's OWN observer (which rebuild()s column widths) joins the loop and
// the two ping-pong every frame, pinning the main thread — reported as
// Obsidian hanging. Keeping the theme's existing border width and only
// zeroing its color is ZERO layout change, so applyFreeze can no longer
// trigger any ResizeObserver, while the border is still visually gone (our
// box-shadow frame is then the only line, so no doubling either).
function hideBorder(el: HTMLElement, side: 'top' | 'bottom' | 'left' | 'right'): void {
	forceImportant(el, `border-${side}-color`, 'transparent');
}

// Does the active theme paint a real border on this side of this cell? Decides
// whether the frozen block's seam needs a synthetic boundary line at all: with
// border-collapse: separate the cell's own border travels with it when it
// sticks, so when there IS one it already draws the seam better than any
// synthetic line can (exact theme colour, weight and position). Read AFTER our
// own passes have run — nothing we do touches these two sides any more, so the
// value is still the theme's.
function hasRealBorder(cell: HTMLElement, side: 'bottom' | 'right'): boolean {
	const cs = getComputedStyle(cell);
	const style = side === 'bottom' ? cs.borderBottomStyle : cs.borderRightStyle;
	const width = side === 'bottom' ? cs.borderBottomWidth : cs.borderRightWidth;
	return style !== 'none' && style !== 'hidden' && (parseFloat(width) || 0) > 0;
}

/**
 * An element's own offset within the scroll content along one axis — i.e.
 * exactly the `top`/`left` a sticky element needs in order to come to rest
 * where the table's layout already puts it.
 *
 * This replaced a running accumulator (`top += rowHeight` / `left += colWidth`,
 * starting at 0) that was wrong by a constant: 0 means "flush against the
 * scrollport's content edge", but the first row/column doesn't start there — the
 * table's own outer border sits in front of it (with a collapsed 2px frame, the
 * first cell began 1px in). Every frozen cell therefore jumped by that constant
 * the instant it stuck, which is what dragged the block out of alignment with
 * the scrolling rows below it: measured as a hard 1px shift under the grid theme
 * (2px outer border), and the visible result was the block's own gridlines
 * landing on top of each other's opaque backgrounds, so they disappeared.
 * Measuring each element's real offset can't drift like that, and needs no
 * knowledge of what's in front of it (border, spacing, margin — anything).
 *
 * Adding the current scroll position back is what makes this scroll-invariant:
 * getBoundingClientRect is a viewport reading, so it already has the scroll
 * subtracted out, and applyFreeze can run at any scroll position.
 */
function scrollOffset(el: HTMLElement, axis: 'x' | 'y'): number {
	const scroller = el.closest<HTMLElement>('.bt-table-wrapper');
	if (!scroller) return 0;
	const box = scroller.getBoundingClientRect();
	const cs = getComputedStyle(scroller);
	const rect = el.getBoundingClientRect();
	return axis === 'x'
		? rect.x + scroller.scrollLeft - (box.x + (parseFloat(cs.borderLeftWidth) || 0))
		: rect.y + scroller.scrollTop - (box.y + (parseFloat(cs.borderTopWidth) || 0));
}

// Deliberately NOT rounded to whole device pixels. That was tried against the
// frozen block re-rasterizing at a fractional devicePixelRatio and made no
// measurable difference whatsoever (byte-identical pixel diffs before and
// after), because the cause isn't this offset: at dpr 1.5 a scroll of 1 CSS px
// is 1.5 device px, so the compensating translation the browser gives a sticky
// element is fractional regardless of what `left` we set. Rounding would only
// introduce a sub-pixel tiling mismatch between adjacent frozen columns — a
// place for scrolling content to show through — in exchange for nothing.

function clearCell(el: HTMLElement): void {
	el.removeClass('bt-frozen-row');
	el.removeClass('bt-frozen-col');
	el.style.removeProperty('--bt-frozen-top');
	el.style.removeProperty('--bt-frozen-left');
	el.style.removeProperty('--bt-frozen-box-shadow-scratch');
	el.style.removeProperty('box-shadow');
	el.style.removeProperty('background-color');
	el.style.removeProperty('border-top-color');
	el.style.removeProperty('border-bottom-color');
	el.style.removeProperty('border-left-color');
	el.style.removeProperty('border-right-color');
}

export function applyFreeze(table: HTMLTableElement, thead: HTMLElement, tbody: HTMLElement, model: TableModelV2): void {
	// Includes tr.bt-frozen-row, which no rebuild produces any more but an
	// in-place table rendered by an older build still carries — clearCell is
	// harmless on a <tr> and removing the class is what un-sticks it.
	table.querySelectorAll<HTMLElement>('.bt-frozen-row, .bt-frozen-col').forEach(clearCell);

	const freezeRows = model.freezeRows !== undefined && canFreezeRows(model, model.freezeRows) ? model.freezeRows : undefined;
	const freezeCols = model.freezeCols !== undefined && canFreezeCols(model, model.freezeCols) ? model.freezeCols : undefined;
	// The .bt-table-wrapper is always a bounded scroll container now (styles.css:
	// max-height + overflow:auto), so a frozen header/row's sticky top always
	// has something to stick against — no per-table freeze flag needed.
	// The table's own outer top/left border is on <table> (not sticky), so it
	// scrolls away with the table box once frozen content sticks — the frozen
	// block draws its own top/left frame line below instead, so suppress the
	// real one to avoid a doubled line at rest. Inline, same reasoning as the
	// cell overrides.
	//
	// Reset (not just re-override) BEFORE reading getComputedStyle below — on a
	// second+ pass with freeze still active, a prior call already left this
	// 'transparent', and reading it back would just echo 'transparent' forever
	// instead of the theme's real color.
	table.style.removeProperty('border-top-color');
	table.style.removeProperty('border-left-color');
	// A theme that draws a real, visible outer border (e.g. grid's bold 2px
	// frame — --bt-border-outer) had that border silently replaced by the
	// frozen frame's generic, theme-neutral line below (LINE, a subtle
	// --background-modifier-border by default) — reported as "the left
	// border disappeared" once column freeze was on, which it effectively
	// did: a bold themed line was swapped for a much fainter unrelated one.
	// Reading the table's OWN actual resolved border color here — while it's
	// still the theme's real value, one line above the override that hides
	// it — and using THAT as the outer frame's line color (instead of the
	// generic LINE) reproduces the active theme's outer border automatically,
	// for any theme, with no per-theme configuration needed. This is
	// deliberately narrower than the "replicate every cell's decoration"
	// approach the VISUAL MODEL note above already tried and abandoned as
	// fragile — it's a single table-level value, not N per-cell ones, so it
	// can't develop the same per-theme/per-zoom gaps that approach did.
	// borderTopStyle/-LeftStyle guard against a theme with NO outer border at
	// all (default: none) — computed border-color still resolves to SOME
	// value even when unpainted, and using that unrelated value here would
	// change every other theme's frozen-frame color as a side effect nobody
	// asked for; falling through to the existing generic LINE default (via
	// the var() fallback below) keeps their look exactly as before.
	const tableStyle = getComputedStyle(table);
	const outerTopColor  = tableStyle.borderTopStyle  !== 'none' ? tableStyle.borderTopColor  : null;
	const outerLeftColor = tableStyle.borderLeftStyle !== 'none' ? tableStyle.borderLeftColor : null;
	// Width matters too, not just color — a real border is painted OUTSIDE the
	// cell's own box, but an inset box-shadow is painted INSIDE it, so simply
	// reusing the theme's exact border-width value as the shadow's inset
	// offset doesn't perfectly reproduce the border's own footprint pixel-for-
	// pixel — but it gets far closer than a mismatched fixed 1px did (e.g.
	// grid's real 2px frame meeting a synthetic 1px line at the corner,
	// visibly not a clean rectangle). Parsed as a number since box-shadow's
	// offset needs a bare px value, not the "2px" string computed style
	// returns.
	const outerTopWidth  = outerTopColor  !== null ? parseFloat(tableStyle.borderTopWidth)  || 1 : 1;
	const outerLeftWidth = outerLeftColor !== null ? parseFloat(tableStyle.borderLeftWidth) || 1 : 1;
	// --bt-frozen-divider still wins if a user/theme explicitly set it (the
	// var() fallback only kicks in when it's unset) — same override contract
	// as the generic LINE constant above, just per-axis here.
	const LINE_TOP  = `var(--bt-frozen-divider, ${outerTopColor  ?? 'var(--background-modifier-border)'})`;
	const LINE_LEFT = `var(--bt-frozen-divider, ${outerLeftColor ?? 'var(--background-modifier-border)'})`;
	if (freezeRows !== undefined) forceImportant(table, 'border-top-color', 'transparent');
	if (freezeCols !== undefined) forceImportant(table, 'border-left-color', 'transparent');
	if (freezeRows === undefined && freezeCols === undefined) return;

	if (freezeRows !== undefined) {
		const allTrs = [...Array.from(thead.querySelectorAll<HTMLElement>('tr')), ...Array.from(tbody.querySelectorAll<HTMLElement>('tr'))];
		for (const tr of allTrs) {
			// 0 = header, 1..N = data rows in display order. Aggregate/hidden-row-
			// indicator rows have no [data-row] cell and are never frozen.
			const idxAttr = tr.querySelector<HTMLElement>('[data-row]')?.dataset.row;
			if (idxAttr === undefined) continue;
			const idx = parseInt(idxAttr);
			if (idx > freezeRows) continue;
			// This row's TRUE offset within the scroll content, not an accumulator
			// over the preceding rows' heights (see scrollOffset's own note for why
			// accumulating is wrong by exactly the table's own border). Safe to read
			// the row's live rect here: the class that makes its cells sticky is
			// applied below, per cell, so at this point the row is still laid out
			// where the table actually puts it. (A row FURTHER UP already had its
			// cells stuck by an earlier iteration, but a sticky element's offset
			// never changes the layout position of anything else, so this row's
			// rect is unaffected by that.)
			const top = scrollOffset(tr, 'y');
			for (const cell of Array.from(tr.children) as HTMLTableCellElement[]) {
				seedThemeShadow(cell);
				cell.addClass('bt-frozen-row');
				// Per-cell, not on the <tr> — a sticky <tr> would be an atomic
				// paint unit and cover an earlier row's rowSpan cell. See the
				// ROW-FREEZE STICKS EACH CELL note in styles.css.
				cell.setCssProps({ '--bt-frozen-top': `${top}px` });
				// A rowSpan>1 merge only has a DOM element in its own ANCHOR
				// row's <tr> — the rows it covers have no separate cell there
				// at all (buildOccupied/rendering skips them) — so `idx` alone
				// (the anchor's own row index) is the wrong test for "is this
				// cell's TRUE bottom edge the frozen band's last row": a merge
				// anchored one row above the boundary, spanning down INTO it,
				// has idx !== freezeRows even though its rendered bottom edge
				// sits exactly there. Same colSpan-vs-ci fix already applied to
				// the column-freeze loop below, mirrored here for rows (a merge
				// spanning rows AND columns, anchored inside the frozen block,
				// otherwise never got its bottom seam at all — reported as a
				// line missing/leaking exactly at that merge's edge, with
				// nothing behind it to occlude the scrolling content either).
				const rowEnd = idx + (cell.rowSpan || 1) - 1;
				// NO border is suppressed on the bottom edge any more, and no
				// synthetic line replaces it: a cell's borders now belong to the
				// cell (border-collapse: separate) and therefore travel with it
				// when it sticks, so the theme's own real border already draws the
				// seam — in the theme's exact colour, weight and position, for
				// free. Replacing it with a synthetic line was measured doing
				// active harm: hideBorder removed grid's near-black rule and the
				// generic replacement line (--background-modifier-border, a pale
				// grey) was both far fainter AND 1px off, since an inset shadow is
				// clipped to the padding box while a border sits outside it.
				// Sampled at the seam under grid: the boundary pixel went from
				// luminance 17 (the theme's line) to 255 (nothing at all), with
				// only a faint 204 smudge one pixel up — reported as "A3 和 A4
				// 之间的横线丢失".
				//
				// Only a theme that draws NO border there needs a synthetic line,
				// which is handled at the seam below.
				if (idx === 0) hideBorder(cell, 'top');
				const colAttr = cell.dataset.col;
				const customBg = colAttr !== undefined ? cellEffectiveStyle(model, idx, parseInt(colAttr)).bg : undefined;
				opaqueBg(cell, customBg);
				// Frame: the header row (idx 0) gets the block's TOP line —
				// matching the theme's own (now-suppressed) outer border color.
				//
				// OUTSET, not inset: the table's real outer border sits in front of
				// the first cell and scrolls away with the table, leaving a strip
				// (as wide as that border) between the scrollport edge and the
				// frozen block that no frozen cell covers — measured as scrolling
				// content leaking through a 2px band along the block's top edge
				// under the grid theme. Drawing the frame line OUTSIDE the cell
				// fills exactly that strip, so the line lands where the real border
				// was rather than one border-width inside it. Outset works here only
				// because the table is border-collapse: separate — Chromium doesn't
				// paint a non-inset box-shadow on a cell under collapse (see the
				// --bt-frozen-*-shadow note in styles.css, which still applies to
				// the elevation shadows: those must stay inset, since an outset
				// elevation shadow would fall OUTSIDE the block and darken the
				// scrolling region instead of the seam).
				if (idx === 0) addBoxShadow(cell, `0 -${outerTopWidth}px 0 0 ${LINE_TOP}`);
				// The two outset frame lines are pure offsets with no spread, so each
				// covers only the strip directly above / directly left of its cell —
				// leaving the diagonal square where they meet uncovered, which showed
				// up as a tiny hole at the block's top-left corner (measured: a 2x2px
				// leak under grid's 2px frame, exactly one border-width square). A
				// spread would fill it but would also bleed the line sideways past
				// the block's other corners, so patch the one square directly. Only
				// meaningful when BOTH axes are frozen — the left strip it completes
				// doesn't exist without column freeze.
				if (idx === 0 && colAttr === '0' && freezeCols !== undefined) {
					addBoxShadow(cell, `-${outerLeftWidth}px -${outerTopWidth}px 0 0 ${LINE_TOP}`);
				}
				// Seam: the last frozen row gets an elevation shadow against the
				// scrolling region below it, so the block reads as floating above
				// it. The boundary LINE itself is the cell's own real border (see
				// the note above) — synthesized here only for a theme that draws
				// no border there at all, which would otherwise leave the block
				// and the scrolling region visually merged. Outset, at the real
				// border's position rather than one pixel inside it.
				if (rowEnd === freezeRows) {
					if (!hasRealBorder(cell, 'bottom')) addBoxShadow(cell, `0 1px 0 0 ${LINE}`);
					addBoxShadow(cell, 'var(--bt-frozen-row-shadow, inset 0 -6px 6px -6px rgba(0, 0, 0, 0.3))');
				}
			}
		}
	}

	if (freezeCols !== undefined) {
		// A theme may draw the table's bottom rule as a box-shadow on <tbody>
		// itself (academic.css's bottomrule), not on the cells — the opaque
		// frozen-column cells paint over it, so the bottom line vanished under
		// the frozen columns. It can't be read from a cell (box-shadow isn't
		// inherited), so read tbody's directly and redraw it on the frozen
		// columns' cells in the LAST data row. Frozen ROWS never reach the
		// table bottom (they're the top rows), so this only concerns columns.
		const tbodyShadow = getComputedStyle(tbody).boxShadow;
		const dataRows = Array.from(tbody.querySelectorAll<HTMLElement>('tr')).filter(tr => tr.querySelector('[data-row]'));
		const lastRow = dataRows[dataRows.length - 1];
		for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
			const ci = c.dataset.col !== undefined ? parseInt(c.dataset.col) : undefined;
			// Measured off the <col>, which is never sticky (the class is scoped to
			// td/th below), so its rect is always the column's true layout box even
			// while its cells are stuck somewhere else. Exact fractional offset, not
			// rounded, so adjacent frozen columns tile perfectly against each other
			// with no sub-pixel gap for scrolling content to show through.
			const left = scrollOffset(c, 'x');
			if (ci !== undefined && ci < freezeCols) {
				// Scoped to td/th — a <col> also carries data-col, so an unscoped
				// [data-col] query would match the <col> itself too. Typed as
				// HTMLTableCellElement (not HTMLElement) so .colSpan below is
				// accessible without a cast — every match is guaranteed to be a
				// real <td>/<th> by the selector itself.
				table.querySelectorAll<HTMLTableCellElement>(`td[data-col="${ci}"], th[data-col="${ci}"]`).forEach(cell => {
					seedThemeShadow(cell);
					cell.addClass('bt-frozen-col');
					cell.setCssProps({ '--bt-frozen-left': `${left}px` });
					// Only the block's outer LEFT edge is suppressed and replaced by
					// a synthetic frame line (the real one lives on <table> and
					// scrolls away). The right edge at the seam keeps its own real
					// border — see the matching row-freeze note above for why
					// replacing it was actively worse.
					if (ci === 0) hideBorder(cell, 'left');
					const rowAttr = cell.dataset.row;
					const customBg = rowAttr !== undefined ? cellEffectiveStyle(model, parseInt(rowAttr), ci).bg : undefined;
					opaqueBg(cell, customBg);
					// Frame: the first frozen column (ci 0) gets the block's LEFT line —
					// matching the theme's own (now-suppressed) outer border color.
					// Outset, mirroring the row-freeze top frame above — see that
					// comment for why (the table's real left border scrolls away and
					// leaves an uncovered strip at the scrollport edge).
					if (ci === 0) addBoxShadow(cell, `-${outerLeftWidth}px 0 0 0 ${LINE_LEFT}`);
					// Redraw the theme's tbody-drawn bottom rule (see above) on the
					// last data row's frozen cells.
					if (cell.parentElement === lastRow && tbodyShadow && tbodyShadow !== 'none') {
						addBoxShadow(cell, tbodyShadow);
					}
					// Seam: the last frozen column gets the boundary line + elevation
					// shadow against the scrolling region to its right. `ci` is this
					// cell's own START column (that's what the query above matched on)
					// — for a colSpan>1 merge, its true right edge is `ci + colSpan - 1`,
					// not `ci` itself. A merge entirely within the frozen columns (the
					// only kind canFreezeCols allows) whose right edge lands exactly on
					// the boundary would otherwise never get this treatment at all: the
					// query for `ci === freezeCols - 1` only ever matches a cell whose
					// OWN data-col equals that index, and a covered position within a
					// colspan has no separate element there to match — reported as a
					// merged cell's right edge missing the frozen-boundary shadow.
					if (ci + (cell.colSpan || 1) - 1 === freezeCols - 1) {
						// Boundary line = the cell's own real border, synthesized
						// only when the theme draws none — see the row-freeze seam.
						if (!hasRealBorder(cell, 'right')) addBoxShadow(cell, `1px 0 0 0 ${LINE}`);
						addBoxShadow(cell, 'var(--bt-frozen-col-shadow, inset -6px 0 6px -6px rgba(0, 0, 0, 0.3))');
					}
				});
			}
		}
	}
}
