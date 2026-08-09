/**
 * Cross-rebuild selection handoff — the keyboard-navigation twin of
 * renderEditHandoff.ts / renderHoverHandoff.ts, built on the same generic
 * createHandoff() factory (renderStateHandoff.ts).
 *
 * The Selected cell (see cellNav.ts, and renderer.ts's `sel`) is purely local
 * state: nothing about it is stored in the model, and its only trace in the DOM
 * is a `.bt-selected` class. A write-back replaces the whole table with a
 * brand-new TableBlock instance whose `sel` starts empty (see the "Write-back
 * architecture" note in CLAUDE.md), so without this, committing a cell with
 * Tab — which is exactly when a value change fires a write-back — would drop
 * the highlight off the cell the user just navigated to, a step they took
 * deliberately a few milliseconds earlier.
 *
 * The OLD instance records which cell was Selected at write-back-trigger time
 * (tableBlock.ts's queueOp, reading its own still-live DOM); the NEW instance
 * reads it back once during render and re-applies the highlight. Same
 * fact-driven shape as the hover handoff: record what was true, restore it,
 * rather than trying to ask the freshly-built DOM about state it never had.
 */
import { createHandoff } from './renderStateHandoff';
import type { NavCell } from './cellNav';

const handoff = createHandoff<NavCell>();

/**
 * Called at write-back trigger time, while the old DOM is still readable. Pass
 * `null` when there is no single selected cell to carry over — either nothing
 * was selected, or the selection is a multi-cell drag range, which this
 * single-cell mechanism deliberately doesn't cover.
 */
export function registerSelectedCell(cacheKey: string, cell: NavCell | null): void {
	if (cell) handoff.register(cacheKey, cell);
	else handoff.clear(cacheKey);
}

/**
 * Consumes and returns the cell that was Selected before this table's last
 * write-back rebuild, or undefined if none was recorded. The caller is expected
 * to re-validate it against the current model (clampToValidCell) — the very
 * operation that triggered the rebuild may have deleted that row or column.
 */
export function takeSelectedCell(cacheKey: string): NavCell | undefined {
	return handoff.take(cacheKey);
}
