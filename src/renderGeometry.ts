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
