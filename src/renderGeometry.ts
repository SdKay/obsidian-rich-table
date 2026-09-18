import { SEL_TOTAL, SEL_CELL, AUTOFIT_OFFSET } from './selectorLayout';

/**
 * `renderZoom.ts`'s `zoom` (CSS `zoom`, not `transform`) scales every
 * descendant's RENDERED size — `getBoundingClientRect()` reports the scaled
 * (visual) box — while every OTHER geometry primitive that matters here
 * (`style.width`, `scrollLeft`/`scrollWidth`/`clientWidth`, an inline
 * `--css-var: <n>px` this file itself writes) stays in unscaled (logical)
 * px. `computeVisibleGeom`/`scrollContentOffset` are the two shared "where is
 * this element" answers every positioning consumer in this codebase already
 * goes through (see this file's own top-of-file doc comment on why there's
 * exactly one of each) — dividing their VISUAL (getBoundingClientRect-
 * derived) measurements by `zoom` here, once, is what keeps every existing
 * consumer's `1 unit = 1 logical px` assumption true again without that
 * consumer needing to know zoom exists at all.
 *
 * `zoom` is a plain factor (1 = no zoom), not measured from the DOM —
 * renderer.ts is the one place that ever SETS the CSS `zoom` property (from
 * `model.zoom`), so it already knows the exact factor with no ambiguity;
 * measuring it back out via `getComputedStyle` was tried and rejected: a
 * plain descendant's OWN computed `zoom` value does not reflect an ancestor's
 * zoom at all (confirmed empirically — only the ratio of
 * `getBoundingClientRect()` to `offsetWidth`/`offsetHeight` recovers the true
 * effective factor, and that ratio is undefined/unreliable for a
 * currently-zero-sized element, e.g. a hover-only strip before its first
 * layout). A plain passed-in number sidesteps both problems entirely.
 */
export const NO_ZOOM = 1;

/**
 * Fallback for the few call sites (`reserveSelectorLeftPad` below) that have
 * no access to renderer.ts's own closure-local `zoom` number and therefore
 * can't be handed the factor directly — measures it back off `root` itself
 * via the ratio of its rendered (visual) size to its logical size. Safe
 * specifically HERE because `root` always contains a real, already-laid-out
 * table with non-zero height by the time this runs (unlike an arbitrary
 * currently-zero-sized element, e.g. a hover-only strip before first layout,
 * where this same ratio would be 0/0 — see NO_ZOOM's own doc comment for why
 * that degenerate case is why every OTHER consumer takes zoom as a plain
 * parameter instead of measuring it locally).
 */
export function measureZoomFactor(root: HTMLElement): number {
	const offset = root.offsetHeight;
	if (offset === 0) return NO_ZOOM;
	return root.getBoundingClientRect().height / offset;
}

/**
 * The one place that answers "where is this element within the scrolling
 * content?" — shared by the frozen region (renderFreeze.ts) and the row/column
 * selector strips (renderer.ts), because those two have to agree exactly.
 *
 * They didn't. The strips accumulated `parseFloat(col.style.width)` from 0 while
 * the frozen cells used a measured offset, and a comment in renderer.ts asserted
 * the two were "the same table-relative left offset … just reusing the existing
 * one" — which was never true, only coincidentally equal while both happened to
 * start from zero. The moment the frozen side started measuring properly, the
 * strips silently drifted by the table's own border width: the resize hover zone
 * for a frozen column no longer sat on the boundary it resizes.
 *
 * Hence one function rather than two conventions. Anything that needs to line up
 * with a sticky element must get its coordinate from here.
 */

/**
 * `el`'s offset from the scroll container's content origin along one axis —
 * i.e. exactly the `top`/`left` a `position: sticky` element needs in order to
 * come to rest where the layout already puts it.
 *
 * Measured, not accumulated: 0 means "flush against the scrollport's content
 * edge", but the first row/column doesn't start there — the table's own outer
 * border sits in front of it. An accumulator is therefore wrong by that width,
 * and needs to know about every box in front of it (border, spacing, margin) to
 * be right; a measurement needs to know about none of them.
 *
 * Adding the current scroll position back is what makes the result
 * scroll-invariant: getBoundingClientRect is a viewport reading, so it already
 * has the scroll subtracted out, and callers run at arbitrary scroll positions.
 *
 * Deliberately NOT rounded to whole device pixels. That was tried against the
 * frozen region re-rasterizing at a fractional devicePixelRatio and made no
 * measurable difference at all (byte-identical pixel diffs before and after),
 * because the cause isn't this offset: at dpr 1.5 a scroll of 1 CSS px is 1.5
 * device px, so the compensating translation the browser gives a sticky element
 * is fractional regardless of what offset we set. Rounding would only introduce
 * a sub-pixel tiling mismatch between adjacent frozen columns — somewhere for
 * scrolling content to show through — in exchange for nothing.
 */
export function scrollContentOffset(el: HTMLElement, axis: 'x' | 'y', zoom: number = NO_ZOOM): number {
	const scroller = el.closest<HTMLElement>('.bt-table-wrapper');
	if (!scroller) return 0;
	const box = scroller.getBoundingClientRect();
	const cs = getComputedStyle(scroller);
	const rect = el.getBoundingClientRect();
	// scrollLeft/scrollTop and the computed border width are already logical
	// (unaffected by `zoom` — confirmed empirically, see NO_ZOOM's own doc
	// comment); only the two getBoundingClientRect() reads are visual, so only
	// their DIFFERENCE (which is what actually needs dividing) goes through
	// `/ zoom` — dividing the pre-summed result would incorrectly scale the
	// already-logical scroll/border terms too.
	return axis === 'x'
		? (rect.x - box.x) / zoom + scroller.scrollLeft - (parseFloat(cs.borderLeftWidth) || 0)
		: (rect.y - box.y) / zoom + scroller.scrollTop - (parseFloat(cs.borderTopWidth) || 0);
}

export interface VisibleGeom {
	tr: DOMRect; rr: DOMRect; wr: DOMRect;
	tt: number; th: number;
	vl: number; vw: number; colOffset: number;
	vt: number; vh: number; rowOffset: number;
}

/**
 * Visible-viewport geometry of `table` within `wrapper` (the horizontal/
 * vertical scroll container), in `root`-relative px — the shared answer to
 * "where, and how much of the table, is actually on screen right now",
 * originally a closure-local `computeVisibleGeom` in renderer.ts. Pulled out
 * here, not just left there, because every one of its callers (the edge-add
 * strips, the row/column selector strips, the ctrl column) needs to run this
 * exact computation on a shared `wrapper` scroll event — see
 * `renderScrollSync.ts`'s `bindScrollSync`, which computes it ONCE per
 * coalesced frame and hands the same object to all three, instead of each
 * independently spending 3 getBoundingClientRect() reads (9 total) on
 * identical geometry every frame.
 *
 *   vl/vt      visible top-left corner        vw/vh      visible width/height
 *   colOffset  how far the table's own left sits left of the visible left
 *              (≤ 0) — added to every column-selector child's left so column
 *              letters/grips/resize seams scroll horizontally in lockstep
 *              with the table body and clip cleanly at the visible edges
 *              (overflow:hidden on the col strip). rowOffset is its vertical
 *              mirror, for the row selector's own inner-scroll tracking.
 */
export function computeVisibleGeom(table: HTMLElement, root: HTMLElement, wrapper: HTMLElement, zoom: number = NO_ZOOM): VisibleGeom {
	const tr = table.getBoundingClientRect();
	const rr = root.getBoundingClientRect();
	const wr = wrapper.getBoundingClientRect();
	const visLeft   = Math.max(tr.left, wr.left);
	const visRight  = Math.min(tr.right, wr.right);
	const visTop    = Math.max(tr.top, wr.top);
	const visBottom = Math.min(tr.bottom, wr.bottom);
	// tr/rr/wr themselves stay VISUAL (raw getBoundingClientRect) — some callers
	// (e.g. the "did root grow taller than wrapper by an anomalous amount"
	// check) compare two of these rects directly against each other, which is
	// self-consistent without any zoom correction at all. Every DERIVED field
	// below is a DIFFERENCE between two visual rects, which is exactly the
	// quantity `/ zoom` recovers as a true logical distance — same reasoning
	// as scrollContentOffset's own correction, and the one this function's own
	// callers actually consume as "an offset/size in root's logical px".
	return {
		tr, rr, wr,
		tt: (tr.top - rr.top) / zoom,
		th: tr.height / zoom,
		vl: (visLeft - rr.left) / zoom,
		vw: Math.max(0, visRight - visLeft) / zoom,
		colOffset: (tr.left - visLeft) / zoom,
		vt: (visTop - rr.top) / zoom,
		vh: Math.max(0, visBottom - visTop) / zoom,
		rowOffset: (tr.top - visTop) / zoom,
	};
}

/**
 * The initial, first-paint counterpart of renderer.ts's own `reserveLeftPad`
 * (its doc comment there has the full reasoning for what this padding is and
 * why it's now reserved PERMANENTLY, never collapsed back on mouseleave, for
 * every table — no nested-vs-top-level distinction). Kept as a standalone,
 * DOM-derived function rather than reusing that closure-local one because it
 * must run from tableBlock.ts's render(), AFTER the atomic DOM swap that
 * first makes the table's own container genuinely attached and measurable —
 * the same reason applyAutoColWidths (renderAutofit.ts) is its own
 * standalone post-swap call rather than something renderTable() does
 * internally (it runs against a still-detached tree there). Runs for every
 * `.bt-render-root` a render just produced, a NESTED table's own root
 * included — found by the exact same blanket query, with no special-casing
 * of its own to tell the two apart (see tableBlock.ts).
 *
 * `leftNeed` is re-derived from the DOM (whether `root` actually has
 * selector-strip elements at all) rather than threaded in from renderer.ts's
 * own CTRL_COL_LEFT_GAP, since this runs from an entirely separate call site
 * with no access to that closure.
 */
export function reserveSelectorLeftPad(root: HTMLElement): void {
	const wrapper = root.querySelector<HTMLElement>('.bt-table-wrapper');
	if (!wrapper) return;
	const hasSelectors = !!root.querySelector('.bt-col-selector, .bt-row-selector');
	const leftNeed = hasSelectors ? (SEL_TOTAL + AUTOFIT_OFFSET + 4) : (SEL_CELL + 4);
	const zoom = measureZoomFactor(root);
	const wr0 = wrapper.getBoundingClientRect();
	const rr0 = root.getBoundingClientRect();
	const currentPad = parseFloat(root.style.getPropertyValue('--bt-sel-pad-left')) || 0;
	// (wr0.left - rr0.left) is visual; currentPad is the logical px this
	// function itself already wrote — same unit-consistency correction as
	// renderer.ts's own reserveLeftPad (see that function's own comment).
	const leftRoom = (wr0.left - rr0.left) / zoom - currentPad;
	const leftPad = leftRoom < leftNeed ? Math.ceil(leftNeed - leftRoom) : 0;
	if (leftPad !== currentPad) root.setCssProps({ '--bt-sel-pad-left': `${leftPad}px` });
}

/**
 * The initial, first-paint counterpart of renderer.ts's own closure-local
 * `updateOuterFrame` — same "must run post-swap, against a genuinely attached
 * tree" reasoning as reserveSelectorLeftPad above, and the same "standalone,
 * DOM-derived, found by blanket query" shape. Sizes `.bt-outer-frame` (a
 * `.bt-render-root-shell` child, sibling of `.bt-render-root`) to cover
 * root's own box, extended down to a PINNED status bar (already in normal
 * flow, so shell's own rect already includes it) or a currently-VISIBLE
 * hover-mode one (position:absolute, never contributing to shell's box on
 * its own — see renderer.ts's own updateOuterFrame for the full reasoning).
 */
export function applyOuterFrame(root: HTMLElement): void {
	const shell = root.closest<HTMLElement>('.bt-render-root-shell');
	const frame = shell?.querySelector<HTMLElement>(':scope > .bt-outer-frame');
	if (!shell || !frame) return;
	const rr = root.getBoundingClientRect();
	if (rr.width === 0) return;
	const shellRect = shell.getBoundingClientRect();
	const statusBar = shell.querySelector<HTMLElement>(':scope > .bt-status-bar');
	let bottom = rr.bottom;
	if (statusBar) {
		if (!statusBar.hasClass('bt-status-mode-hover')) bottom = shellRect.bottom;
		else if (statusBar.hasClass('bt-strip-visible')) bottom = Math.max(bottom, statusBar.getBoundingClientRect().bottom);
	}
	// Raw visual px, no zoom division — `.bt-outer-frame` lives in `shell`,
	// which is never zoomed (see renderer.ts's own `shell` doc comment), same
	// treatment as the status bar's own --sb-* properties.
	frame.setCssProps({
		'--of-l': `${rr.left - shellRect.left}px`,
		'--of-t': `${rr.top - shellRect.top}px`,
		'--of-w': `${rr.right - rr.left}px`,
		'--of-h': `${bottom - rr.top}px`,
	});
}
