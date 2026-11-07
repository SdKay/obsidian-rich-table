/**
 * Keeps the frozen rows and columns in place while the table scrolls. It works the same on a read-only table, and
 * is placed again in the frame whose layout it matches.
 */
import type { TableModelV2 } from './model';
import type { LayoutSync } from './layoutSync';
import { applyFreeze } from './renderFreeze';

export interface RenderFrozenCellsContext {
	model: TableModelV2;
	hooks: { reapplyFreezeNow: () => void };
	view: { zoom: number };
	table: HTMLTableElement;
	layoutSync: LayoutSync;
	thead: HTMLElement;
	tbody: HTMLElement;
	resetHover: () => void;
}

export function renderFrozenCells(ctx: RenderFrozenCellsContext): void {
	const { model, hooks, view, table, layoutSync, thead, tbody, resetHover } = ctx;
	// ── Frozen rows/columns ──────────────────────────────────────────────────
	// Deliberately NOT gated behind onStructuralOp — freeze is a purely visual
	// feature and must work in read-only rendering too, unlike the hover-only
	// selector/edge-add strips below. Also unlike those, it must take effect
	// immediately on first render, not only after the user hovers — but
	// renderTable() itself still builds into a detached tree (see the write-
	// back architecture notes), where getBoundingClientRect() reads all zero,
	// so applyFreeze can't just run once here synchronously. A ResizeObserver
	// naturally fires once the table gains its real size after tableBlock.ts's
	// atomic swap moves it into the live DOM, then again on any later resize/
	// zoom/edit — exactly the live-geometry dependency applyFreeze has.
	// applyFreeze itself writes border-top/-bottom/-left/-right (cleared to
	// none, replaced with a synthetic box-shadow) on cells inside <table> —
	// border is a layout-affecting property, so those writes can change
	// table's own rendered size and re-trigger this same observer from inside
	// its own callback. A tight synchronous re-entrant loop like that risks
	// Chromium's built-in ResizeObserver loop-limit protection silently
	// dropping some notifications mid-sequence, which could leave a run
	// half-applied (e.g. the clear step ran, but the cell it was about to
	// re-add a border-replacement box-shadow to never got reached before the
	// next triggered run started over) — a plausible explanation for
	// borders/shadows being inconsistently missing. Coalescing every fire
	// within a frame into a single rAF-deferred call, rather than running
	// synchronously and possibly re-entrantly, breaks that loop: any
	// self-triggered re-fires during the current frame just find
	// `scheduled` already true and no-op, so at most one real run happens
	// per frame regardless of how many times the observer itself fires.
	// Reset any active hover tint FIRST — applyFreeze's own clearCell()
	// unconditionally wipes and rebuilds box-shadow on every frozen cell, with
	// no idea a hover interaction has ALSO been layering a tint into that same
	// property. Without this, a cell mid-hover when applyFreeze happens to
	// re-run (any geometry change — far more than just resize) ends up with
	// clearHover's cached "restore" value now stale relative to the
	// freshly-rebuilt frame lines; the eventual mouseleave then puts back the
	// WRONG value — reported as an intermittent missing seam line between two
	// frozen columns that appeared only after hovering a few times and
	// cleared on a fresh render (a full re-render starts hoverShadowBase
	// empty, so the race needs an actual hover to have happened first).
	// Clearing hover here guarantees clearCell/rebuild always start from a
	// hover-free state; worst case the tint blips off for a frame and
	// reappears on the next mouse move, imperceptible next to a permanently
	// corrupted line. Shared by both call sites below (the rAF-coalesced
	// observer and the drag handler's synchronous one) so neither can drift
	// from this invariant independently.
	hooks.reapplyFreezeNow = () => {
		resetHover();
		applyFreeze(table, thead, tbody, model, view.zoom);
	};

	// The frozen cells are placed in the frame whose layout they match. It reads whether an axis scrolls
	// (wrapper against table), which a drag of the view's size can flip without the table resizing, so
	// the wrapper's own boxes are part of what the layout signature watches.
	layoutSync.register('reflow', () => hooks.reapplyFreezeNow());
}
