/**
 * Every write-back rebuilds the table's DOM from scratch via a brand-new
 * `TableBlock` instance, constructed around a container Obsidian gives it —
 * the new instance has no way to reach into the previous instance's live DOM
 * (see the "Write-back architecture" note on this in CLAUDE.md: Obsidian
 * hands each reprocess a genuinely fresh, empty element). If a DIFFERENT
 * cell was actively being edited when some OTHER cell's edit committed and
 * triggered that rebuild, the live edit — cursor, not-yet-committed text —
 * would otherwise just be silently destroyed along with the rest of the old
 * DOM, with no way to resume it.
 *
 * This module is a small, table-identity-keyed (by `cacheKey`, the same key
 * `renderCache` in tableBlock.ts uses) registry: whichever cell is currently
 * being edited registers itself here on entry (`registerLiveEdit`) and
 * clears itself on save/cancel (`clearLiveEdit`). The NEXT render for that
 * same table can then check `takeLiveEdit` for the cell it's about to render
 * and, if it matches, resume editing there with whatever draft text was
 * typed — independent of how fast or slow the intervening rebuild happens to
 * be, unlike a fixed-delay heuristic.
 */

interface LiveEdit {
	row: number;
	col: number;
	/** Reads the live draft text/value lazily rather than snapshotting it
	 *  eagerly — reading a property off an already-detached DOM node still
	 *  works fine, so there's no need to capture this at any particular
	 *  instant (which write-back step would even be the "right" instant to
	 *  snapshot at isn't well-defined anyway). */
	getDraftText: () => string;
	registeredAt: number;
}

const liveEdits = new Map<string, LiveEdit>();

/** Entries older than this are ignored on resume — a guard against a leaked
 *  registration if the table is closed/removed before its edit ever resolves
 *  (e.g. the user navigates away mid-edit and no future render ever consumes
 *  it) rather than a timing budget for the resume itself. */
const MAX_AGE_MS = 5000;

export function registerLiveEdit(cacheKey: string, row: number, col: number, getDraftText: () => string): void {
	liveEdits.set(cacheKey, { row, col, getDraftText, registeredAt: Date.now() });
}

/** Call from save()/cancel() so a deliberately-finished edit doesn't linger
 *  and get mistakenly "resumed" by some unrelated future rebuild. */
export function clearLiveEdit(cacheKey: string, row: number, col: number): void {
	const entry = liveEdits.get(cacheKey);
	if (entry && entry.row === row && entry.col === col) liveEdits.delete(cacheKey);
}

/**
 * Consumes (removes) and returns the live edit for (cacheKey, row, col), if
 * one is registered, matches this exact cell, and isn't stale. Called once
 * per cell as a table re-renders — a cell that doesn't match just gets
 * `undefined` and renders normally.
 */
export function takeLiveEdit(cacheKey: string, row: number, col: number): LiveEdit | undefined {
	const entry = liveEdits.get(cacheKey);
	if (!entry || entry.row !== row || entry.col !== col) return undefined;
	liveEdits.delete(cacheKey);
	if (Date.now() - entry.registeredAt > MAX_AGE_MS) return undefined;
	return entry;
}
