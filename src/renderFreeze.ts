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
 * Row-freeze sticks the whole <tr>, not each of its cells individually (a
 * <tr> supports position:sticky directly in modern engines, so one sticky
 * point per row instead of N). Column-freeze stickies each cell — <col>
 * elements can't be positioned.
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

function clearCell(el: HTMLElement): void {
	el.removeClass('bt-frozen-row');
	el.removeClass('bt-frozen-col');
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
	table.querySelectorAll<HTMLElement>('tr.bt-frozen-row').forEach(tr => {
		tr.removeClass('bt-frozen-row');
		tr.style.removeProperty('--bt-frozen-top');
	});
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
		let top = 0;
		for (const tr of allTrs) {
			// 0 = header, 1..N = data rows in display order. Aggregate/hidden-row-
			// indicator rows have no [data-row] cell and are never frozen.
			const idxAttr = tr.querySelector<HTMLElement>('[data-row]')?.dataset.row;
			if (idxAttr === undefined) continue;
			const idx = parseInt(idxAttr);
			if (idx > freezeRows) continue;
			const h = tr.getBoundingClientRect().height;
			tr.addClass('bt-frozen-row');
			tr.setCssProps({ '--bt-frozen-top': `${top}px` });
			for (const cell of Array.from(tr.children) as HTMLElement[]) {
				seedThemeShadow(cell);
				cell.addClass('bt-frozen-row');
				// Only hide the ONE side actually being replaced by a synthetic
				// line below — the very first frozen row's TOP (→ the block's
				// outer top frame) and the very last frozen row's BOTTOM (→ the
				// seam against the scrolling region). Rows strictly BETWEEN
				// those two (multiple frozen rows — e.g. header + a few pinned
				// data rows) keep their own real top/bottom border completely
				// untouched, same as any normal, non-frozen row boundary —
				// unconditionally hiding both on EVERY frozen row (the previous
				// behavior) merged the whole frozen band into one line-less
				// block with no synthetic replacement for those interior
				// boundaries either, which — for freezeRows>0 — silently erased
				// every row separator inside the frozen band, reported as
				// looking broken/incomplete ("看着太丑了") rather than like a
				// deliberate design.
				if (idx === 0) hideBorder(cell, 'top');
				if (idx === freezeRows) hideBorder(cell, 'bottom');
				const colAttr = cell.dataset.col;
				const customBg = colAttr !== undefined ? cellEffectiveStyle(model, idx, parseInt(colAttr)).bg : undefined;
				opaqueBg(cell, customBg);
				// Frame: the header row (idx 0) gets the block's TOP line —
				// matching the theme's own (now-suppressed) outer border color.
				if (idx === 0) addBoxShadow(cell, `inset 0 ${outerTopWidth}px 0 0 ${LINE_TOP}`);
				// Seam: the last frozen row gets the boundary line + elevation
				// shadow against the scrolling region below it. Same width as
				// the outer top frame (outerTopWidth, not a separate hardcoded
				// 1px) — a mismatched width here is invisible on its own axis
				// but visibly misaligns wherever this seam's end meets the
				// column-freeze frame/seam at a shared corner (reported: the
				// thin line poking past, or falling short of, the thicker one
				// right at the corner).
				if (idx === freezeRows) {
					addBoxShadow(cell, `inset 0 -${outerTopWidth}px 0 0 ${LINE}`);
					addBoxShadow(cell, 'var(--bt-frozen-row-shadow, inset 0 -6px 6px -6px rgba(0, 0, 0, 0.3))');
				}
			}
			top += h;
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
		let left = 0;
		for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
			const ci = c.dataset.col !== undefined ? parseInt(c.dataset.col) : undefined;
			// Live geometry, not c.style.width — an auto-layout table never sets
			// an inline width on its <col> elements, so c.style.width would read
			// empty→0 and every frozen column past the first would stack at the
			// same offset. Exact fractional width (not rounded) so adjacent
			// frozen columns' sticky offsets tile perfectly against each other
			// with no sub-pixel gap for scrolling content to show through.
			const w = c.getBoundingClientRect().width;
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
					// Only hide the ONE side actually replaced below — see the
					// matching row-freeze comment above for why (multiple
					// frozen columns must keep their own real internal
					// separator, not just the two true outer edges).
					if (ci === 0) hideBorder(cell, 'left');
					if (ci + (cell.colSpan || 1) - 1 === freezeCols - 1) hideBorder(cell, 'right');
					const rowAttr = cell.dataset.row;
					const customBg = rowAttr !== undefined ? cellEffectiveStyle(model, parseInt(rowAttr), ci).bg : undefined;
					opaqueBg(cell, customBg);
					// Frame: the first frozen column (ci 0) gets the block's LEFT line —
					// matching the theme's own (now-suppressed) outer border color.
					if (ci === 0) addBoxShadow(cell, `inset ${outerLeftWidth}px 0 0 0 ${LINE_LEFT}`);
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
						// Same width as the outer left frame (outerLeftWidth) — see
						// the matching row-freeze seam comment above for why.
						addBoxShadow(cell, `inset -${outerLeftWidth}px 0 0 0 ${LINE}`);
						addBoxShadow(cell, 'var(--bt-frozen-col-shadow, inset -6px 0 6px -6px rgba(0, 0, 0, 0.3))');
					}
				});
			}
			left += w;
		}
	}
}
