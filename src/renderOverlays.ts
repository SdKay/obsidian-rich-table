/**
 * Shows the strips and the toolbar while the pointer is over a table and hides them when it leaves. Both the
 * layout and the visibility change together, before anything is measured, so nothing is placed against a layout
 * that is about to change.
 */
import type { Component } from 'obsidian';
import type { VisibleGeom } from './renderGeometry';
import { isHoverPinned, onHoverUnpinned } from './renderHoverPin';
import { isNoteScrolling, onNoteScrollEnd } from './noteScroll';

export interface RenderOverlaysContext {
	component: Component | undefined;
	/** The table has row/column selector strips (and the hover strips that come with them). */
	hasSelectors: boolean;
	/** The table has anything on its edges at all: the selector strips, or only the toolbar. */
	hasStrips: boolean;
	hooks: { showEdgeStrips: () => void; hideEdgeStrips: () => void; showSelectors: () => void; hideSelectors: () => void; prepareLayout: () => void; liftTitle: () => void; repositionCtrlCol: (geom?: VisibleGeom) => void; updateOuterFrame: () => void };
	shell: HTMLElement;
	root: HTMLElement;
	table: HTMLTableElement;
	reserveLeftPad: () => void;
}

export function renderOverlays(ctx: RenderOverlaysContext): void {
	const { component, hasSelectors, hasStrips, hooks, shell, root, table, reserveLeftPad } = ctx;
	// ── Show/hide overlays on mouse enter/leave ───────────────────────────────
	// With CSS Grid, root already includes all strip areas — hovering them fires
	// enter/leave naturally. No viewport math or rAF throttling needed.
	//
	// Listens on `shell`, not `root`: the status bar is now shell's child but
	// root's SIBLING (see shell's own doc comment — it moved out specifically
	// so its zoom control isn't a descendant of the zoom it's dragging), so a
	// mouse move from the table straight down into the status bar crosses
	// root's own boundary on the way — root-scoped listeners would fire a
	// spurious mouseleave/mouseenter pair mid-move, collapsing every hover-only
	// strip for a moment even though the cursor never actually left the
	// table's overall footprint. `shell` contains both, so that transition
	// never crosses ITS boundary at all.
	//
	// Runs for a table with only its toolbar too (a locked one): the toolbar is always visible there, but its place
	// on a wide table still depends on the padding reserved here (reserveLeftPad, repositionCtrlCol). The selector
	// and edge strips are shown only where the table has them.
	if (hasStrips) {
		// The layout these calls prepare depends only on the table's and the pane's
		// geometry, which every real change (resize, zoom, the view-size drag) already
		// re-applies on its own. Re-entering an unchanged table, as when the note
		// scrolls it under a resting cursor, only has to show the strips: in a long
		// note every rect read below would otherwise re-lay out the whole note.
		let preparedW = -1, preparedL = NaN, preparedTW = -1, preparedTH = -1;
		const layoutChangedSincePrepared = () => {
			const r = root.getBoundingClientRect();
			const t = table.getBoundingClientRect();
			return Math.abs(r.width - preparedW) >= 0.5 || Math.abs(r.left - preparedL) >= 0.5
				|| Math.abs(t.width - preparedTW) >= 0.5 || Math.abs(t.height - preparedTH) >= 0.5;
		};
		// Root's height is left out on purpose: lifting the title on hover changes it
		// every time, without changing anything the reserved padding or the toolbar depend on.
		const recordPrepared = () => {
			const r = root.getBoundingClientRect();
			const t = table.getBoundingClientRect();
			preparedW = r.width; preparedL = r.left; preparedTW = t.width; preparedTH = t.height;
		};
		const onShellEnter = () => {
			if (layoutChangedSincePrepared()) {
				// Runs unconditionally: needed for the ctrl column's own positioning
				// even when nothing else in this handler applies (locked table).
				// prepareLayout re-does reserveLeftPad and updateOuterFrame itself.
				if (hasSelectors) {
					hooks.prepareLayout();
				} else {
					reserveLeftPad();
					hooks.updateOuterFrame();
				}
				hooks.repositionCtrlCol();
				recordPrepared();
			} else if (hasSelectors && root.querySelector(':scope > .bt-table-title')) {
				// The lifted title changes root's height, so the frame has to follow it.
				hooks.liftTitle();
				hooks.updateOuterFrame();
			}
			if (hasSelectors) {
				hooks.showEdgeStrips();
				hooks.showSelectors();
			}
		};
		// A table that only scrolled under the cursor gets its hover once the note
		// comes to rest, if the cursor is still on it.
		let enterSkipped = false;
		shell.addEventListener('mouseenter', () => {
			if (isNoteScrolling()) { enterSkipped = true; return; }
			onShellEnter();
		});
		component?.register(onNoteScrollEnd(() => {
			if (!enterSkipped) return;
			enterSkipped = false;
			if (shell.isConnected && shell.matches(':hover')) onShellEnter();
		}));
		shell.addEventListener('mouseleave', () => {
			enterSkipped = false;
			if (isHoverPinned()) return;
			hooks.hideEdgeStrips(); hooks.hideSelectors();
		});
		component?.register(onHoverUnpinned(() => {
			if (!shell.matches(':hover')) { hooks.hideEdgeStrips(); hooks.hideSelectors(); }
		}));
		hooks.updateOuterFrame();
	}
}
