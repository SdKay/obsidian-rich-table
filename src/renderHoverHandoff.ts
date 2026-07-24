/**
 * Cross-rebuild hover-state handoff — the hover twin of renderEditHandoff.ts.
 *
 * The hover-only selector strips (row/col selectors, edge-add buttons) live
 * inside a table's `.bt-render-root` and show/hide on that root's native
 * mouseenter/mouseleave. A write-back rebuilds the whole table via a brand-new
 * TableBlock instance around a fresh container (see the "Write-back
 * architecture" note in CLAUDE.md), which destroys the old, hovered root and
 * builds a new one that has NEVER received a mouseenter — so its strips start
 * hidden and stay hidden until the user's next real mousemove, reading as a
 * brief "drops out of hover, then recovers" flicker even though the mouse
 * never actually left the table.
 *
 * The new instance can't ask the browser "is the mouse over me?" reliably the
 * instant after the swap — `:hover` recalculation for a freshly-inserted
 * element lags a few ms behind the DOM mutation (confirmed empirically: a real
 * mouseenter was observed firing ~7ms after the swap point, while a synchronous
 * `:hover` check right at the swap still returned false). So instead of asking
 * the (laggy) browser, we carry the FACT forward: the OLD instance records, at
 * the moment the write-back is triggered (while its DOM is still live and its
 * strips' visibility is directly readable), whether the strips were showing.
 * The new instance reads that fact and restores immediately, then does one
 * bounded, self-correcting `:hover` re-check a frame later in case the mouse
 * genuinely did leave during the rebuild.
 *
 * This is the same fact-driven pattern renderEditHandoff uses, not a timing
 * guess: the restore is immediate and unconditional on the recorded fact; the
 * single rAF re-check only UNDOES a restore for the small "mouse actually left"
 * case, with the root's real mouseenter/mouseleave listeners as the final
 * backstop.
 */

const hoverStates = new Map<string, boolean>();

/** Called at write-back trigger time (old DOM still live) to record whether
 *  this table's hover strips were showing. */
export function registerHoverState(cacheKey: string, wasHovered: boolean): void {
	if (wasHovered) hoverStates.set(cacheKey, true);
	else hoverStates.delete(cacheKey);
}

/** Consumes and returns whether this table was hovered before its last
 *  write-back rebuild. Returns false if nothing was recorded. */
export function takeHoverState(cacheKey: string): boolean {
	const was = hoverStates.get(cacheKey) ?? false;
	hoverStates.delete(cacheKey);
	return was;
}
