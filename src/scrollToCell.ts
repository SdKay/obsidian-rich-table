export interface Box { left: number; top: number; right: number; bottom: number }

export interface ScrollRevealInput {
	/** The scroll container's visible box. Visual px (getBoundingClientRect). */
	port: Box;
	/** The cell to reveal. Visual px. */
	target: Box;
	/** How much of the port's left and top the frozen columns and rows cover. Visual px. */
	frozenLeft: number;
	frozenTop: number;
	/** The target sits inside a frozen column or row: it never scrolls, so that axis is left alone. */
	targetFrozenX: boolean;
	targetFrozenY: boolean;
	/** Current scroll and its limits. Logical px, like the element's own scrollLeft/scrollTop. */
	scrollLeft: number;
	scrollTop: number;
	maxScrollLeft: number;
	maxScrollTop: number;
	/** CSS zoom between logical and visual px (1 when none). */
	zoom: number;
}

function axis(portStart: number, portEnd: number, frozen: number, start: number, end: number, scroll: number, max: number, zoom: number): number {
	const from = portStart + frozen;
	let delta = 0;
	if (start < from) delta = start - from;
	else if (end > portEnd) delta = Math.min(end - portEnd, start - from);
	return Math.min(max, Math.max(0, scroll + delta / zoom));
}

/**
 * Where to scroll so a cell is fully visible and not hidden under the frozen rows and columns.
 * The browser's scrollIntoView ignores sticky bands: scrolling back to a cell at the top left leaves
 * it inside the port but underneath them.
 */
export function scrollToReveal(i: ScrollRevealInput): { left: number; top: number } {
	return {
		left: i.targetFrozenX ? i.scrollLeft
			: axis(i.port.left, i.port.right, i.frozenLeft, i.target.left, i.target.right, i.scrollLeft, i.maxScrollLeft, i.zoom),
		top: i.targetFrozenY ? i.scrollTop
			: axis(i.port.top, i.port.bottom, i.frozenTop, i.target.top, i.target.bottom, i.scrollTop, i.maxScrollTop, i.zoom),
	};
}
