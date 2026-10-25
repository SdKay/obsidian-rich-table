/**
 * Whether the note around the tables is scrolling. While it is, a table passing
 * under a resting cursor gets no hover work: each hover reads layout, and in a
 * long note every read re-lays out the whole note. One listener for the plugin.
 */

/** The note's own scroll containers: Live Preview / source, and Reading view. */
const NOTE_SCROLLER = '.cm-scroller, .markdown-preview-view';
const SETTLE_MS = 150;

let scrolling = false;
let settleTimer: number | null = null;
const onSettle = new Set<() => void>();

export const isNoteScrolling = (): boolean => scrolling;

/** Calls `fn` each time a note scroll comes to rest. Returns the function that stops it. */
export function onNoteScrollEnd(fn: () => void): () => void {
	onSettle.add(fn);
	return () => { onSettle.delete(fn); };
}

function onScroll(evt: Event): void {
	const target = evt.target;
	if (!(target instanceof HTMLElement) || !target.matches(NOTE_SCROLLER)) return;
	scrolling = true;
	if (settleTimer !== null) window.clearTimeout(settleTimer);
	settleTimer = window.setTimeout(() => {
		settleTimer = null;
		scrolling = false;
		for (const fn of [...onSettle]) fn();
	}, SETTLE_MS);
}

/** Starts watching `doc`. Returns the function that stops it. */
export function watchNoteScroll(doc: Document): () => void {
	doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
	return () => {
		doc.removeEventListener('scroll', onScroll, { capture: true });
		if (settleTimer !== null) window.clearTimeout(settleTimer);
		settleTimer = null;
		scrolling = false;
	};
}
