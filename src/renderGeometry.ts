import { SEL_TOTAL, SEL_CELL, AUTOFIT_OFFSET } from './selectorLayout';

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
export function scrollContentOffset(el: HTMLElement, axis: 'x' | 'y'): number {
	const scroller = el.closest<HTMLElement>('.bt-table-wrapper');
	if (!scroller) return 0;
	const box = scroller.getBoundingClientRect();
	const cs = getComputedStyle(scroller);
	const rect = el.getBoundingClientRect();
	return axis === 'x'
		? rect.x + scroller.scrollLeft - (box.x + (parseFloat(cs.borderLeftWidth) || 0))
		: rect.y + scroller.scrollTop - (box.y + (parseFloat(cs.borderTopWidth) || 0));
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
export function computeVisibleGeom(table: HTMLElement, root: HTMLElement, wrapper: HTMLElement): VisibleGeom {
	const tr = table.getBoundingClientRect();
	const rr = root.getBoundingClientRect();
	const wr = wrapper.getBoundingClientRect();
	const visLeft   = Math.max(tr.left, wr.left);
	const visRight  = Math.min(tr.right, wr.right);
	const visTop    = Math.max(tr.top, wr.top);
	const visBottom = Math.min(tr.bottom, wr.bottom);
	return {
		tr, rr, wr,
		tt: tr.top - rr.top,
		th: tr.height,
		vl: visLeft - rr.left,
		vw: Math.max(0, visRight - visLeft),
		colOffset: tr.left - visLeft,
		vt: visTop - rr.top,
		vh: Math.max(0, visBottom - visTop),
		rowOffset: tr.top - visTop,
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
	const wr0 = wrapper.getBoundingClientRect();
	const rr0 = root.getBoundingClientRect();
	const currentPad = parseFloat(root.style.getPropertyValue('--bt-sel-pad-left')) || 0;
	const leftRoom = (wr0.left - rr0.left) - currentPad;
	const leftPad = leftRoom < leftNeed ? Math.ceil(leftNeed - leftRoom) : 0;
	if (leftPad !== currentPad) root.setCssProps({ '--bt-sel-pad-left': `${leftPad}px` });
}
