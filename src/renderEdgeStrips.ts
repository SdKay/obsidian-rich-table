/**
 * The "+" strips along the bottom and right edge of an editable table, which add a row or a column. They are
 * shown while the pointer is near the table and never on a read-only one.
 */
import type { TableModelV2 } from './model';
import type { TableEdits } from './tableEdits';
import type { LayoutSync } from './layoutSync';
import type { VisibleGeom } from './renderGeometry';

export interface RenderEdgeStripsContext {
	model: TableModelV2;
	isSwapping: (() => boolean) | undefined;
	edits: TableEdits;
	hooks: { showEdgeStrips: () => void; hideEdgeStrips: () => void; isEdgeStripsVisible: () => boolean; repositionEdgeStrips: (geom?: VisibleGeom) => void };
	root: HTMLElement;
	view: { zoom: number };
	wrapper: HTMLElement;
	contentRow: HTMLElement;
	computeVisibleGeom: () => VisibleGeom;
	layoutSync: LayoutSync;
}

export function renderEdgeStrips(ctx: RenderEdgeStripsContext): void {
	const { model, isSwapping, edits, hooks, root, view, wrapper, contentRow, computeVisibleGeom, layoutSync } = ctx;
	// ── Edge-hover add strips (CSS Grid cells inside bt-render-root) ──
	const canAddRow = edits.can('insert-row'), canAddCol = edits.can('insert-col');
	if (canAddRow || canAddCol) {
		// Both add-strips live INSIDE the wrapper now (the actual scroll
		// container), as normal-flow siblings of <table>, made position:sticky
		// in CSS instead of JS-positioned root-level overlays. Sticky pins each
		// to the wrapper's visible edge on its axis — addRowBtn to the visible
		// bottom (bottom/left/right: always ABOVE the horizontal scrollbar,
		// since sticky resolves against the padding edge and the scrollbar
		// lives outside it), addColBtn to the visible right (top/right, in the
		// flex row it shares with <table> — see contentRow above — so it's
		// always BEFORE the vertical scrollbar for the identical reason).
		// Neither the row/col selectors nor the scrolling table content can
		// extend past either "+": all four are clamped to the exact same
		// wrapper viewport, one true boundary instead of four independently-
		// computed ones. This replaced an oscillating series of JS-computed
		// positions (hug the last row/col / tuck above the scrollbar / anchor
		// to the wrapper's outer edge) that each fixed one reported case while
		// breaking another — the underlying issue was that "where the +
		// belongs" needs to be answered by the browser's own scroll/overflow
		// model, not re-derived in JS from rects on every frame. (addColBtn's
		// HEIGHT is still JS-set, unlike its position — see its own CSS rule
		// and positionEdgeStrips below for why.)
		// Each one is there only when the table can do what it does: a table can take new columns and not rows.
		const strip = (parent: HTMLElement, cls: string, onClick: () => void) => {
			const el = parent.createDiv({ cls });
			el.createSpan({ cls: 'bt-edge-plus', text: '+' });
			el.addEventListener('click', onClick);
			return el;
		};
		const addRowBtn = canAddRow ? strip(wrapper, 'bt-edge-add-row', () =>
			edits.run({ type: 'insert-row', afterRowId: model.rows[model.rows.length - 1]?.id ?? null })) : null;
		const addColBtn = canAddCol ? strip(contentRow, 'bt-edge-add-col', () =>
			edits.run({ type: 'insert-col', afterColId: model.columns[model.columns.length - 1]?.id ?? null })) : null;
		const strips = [addRowBtn, addColBtn].filter((el): el is HTMLDivElement => el !== null);

		hooks.isEdgeStripsVisible = () => strips.some(el => el.hasClass('bt-strip-visible'));

		// Use getBoundingClientRect delta — same reason as positionSelectors: the wrapper's
		// overflow-x:auto can make it an offsetParent in some Chrome builds, so offsetTop/
		// offsetLeft traversal may stop at the wrapper instead of reaching root.
		// getBCR viewport-coordinate subtraction is always root-relative and unambiguous.
		// `geom`, when passed, comes from bindScrollSync's own shared computation
		// (one read for the frame, shared with positionSelectors/positionCtrlCol) —
		// every OTHER call site (resize observers, mouseenter, drag-resize) omits
		// it and gets a fresh one, since those aren't part of that shared frame.
		const positionEdgeStrips = (geom: VisibleGeom = computeVisibleGeom()): boolean => {
			// Stale-root guard: if this renderTable() closure's root has been removed from
			// the DOM by a subsequent atomic swap, any rect we read would be from an
			// unrelated or detached element — bail immediately.
			if (!root.isConnected) return false;

			const g = geom;
			const { tr, rr } = g;
			if (tr.width === 0 || tr.height === 0) return false;
			if (rr.width === 0) return false;
			if (rr.height === 0) {
				window.requestAnimationFrame(() => positionEdgeStrips());
				return false;
			}
			// Double-content guard: root height should never exceed the WRAPPER height by
			// more than root's own OTHER real chrome — title, footer, status bar, the
			// top strip-pad reservation — can plausibly add. rr.height >> wrapper height
			// means the DOM contains two stacked roots (cache clone injection window),
			// producing the anomalous rr.height≈1113 in logs. Referencing the WRAPPER
			// (not the table) is deliberate: a wide table adds a horizontal scrollbar
			// (~12-15px) that inflates the wrapper AND root heights equally — comparing
			// against the table height instead used to trip this guard on every
			// scrollable table, silently killing both edge-add buttons.
			//
			// A flat constant here (tried first: 60, sized only for the top strip-pad)
			// is exactly the failure mode to avoid — it has already needed bumping once
			// per new chrome element (adding the status bar, Task 4, immediately tripped
			// it for nearly every editable table, not just a title+footer edge case:
			// reported as "行列增加按钮没了", the add-row/col buttons just gone — a plain
			// table with no title/footer was ALREADY sitting exactly at the old ceiling
			// before that addition). Any FUTURE root-level chrome would silently
			// reintroduce the same class of bug the same way. 220px is a generous
			// worst-case budget for everything root can legitimately add today (title +
			// footer, each up to a few wrapped lines, + the status bar + the strip-pad
			// reservation) while staying nowhere near the true anomaly's ~1113px, so it
			// doesn't need retuning for a normal chrome change — but it's still a guess
			// bounding an open set, not a computed value; if root gains something
			// legitimately taller than this (e.g. a very long multi-line footer), widen
			// it rather than re-deriving it from the current chrome list.
			if (rr.height > g.wr.height + 220) return false;
			// Table fully scrolled out of the visible viewport (either axis). Uses the
			// clamped visible width/height, NOT the raw table top — with inner vertical
			// scroll a negative table top (tt) is normal (table scrolled up under a
			// frozen/pinned region), so the old `tt < -5` check wrongly bailed then.
			if (g.vw <= 0 || g.vh <= 0) return false;
			// addColBtn needs no JS left/top positioning (sticky handles both — see
			// the comment at its creation above), but its HEIGHT still comes from
			// here: g.vh is the clamped visible table height (min of the table's own
			// height and the wrapper's), which is what gives the sticky box "room to
			// move" within — see .bt-edge-add-col's own CSS comment for why a taller
			// (unclamped) height breaks sticky tracking outright. Cheaper than the old
			// full position computation, and — unlike that one — doesn't need to run
			// every scroll frame (g.vh is scroll-invariant except at the very first/
			// last few px of travel), but piggybacking on the existing scroll-driven
			// call below costs nothing extra.
			addColBtn?.setCssProps({ '--strip-height': `${g.vh}px` });
			// addRowBtn needs no JS position math either (sticky handles bottom/
			// left/right — see its own CSS comment), but its --strip-max-width
			// does: caps it to contentRow's (table + addColBtn) rendered width so
			// it matches the table instead of always stretching to the full
			// visible viewport — a no-op for a table that itself needs the full
			// viewport (wide table, horizontal scroll), since the cap then
			// exceeds what left:0/right:0 would render anyway.
			addRowBtn?.setCssProps({ '--strip-max-width': `${contentRow.getBoundingClientRect().width / view.zoom}px` });

			return true;
		};
		hooks.repositionEdgeStrips = (geom) => { positionEdgeStrips(geom); };

		let hideTimer: number | null = null;
		const scheduleHide = () => {
			if (hideTimer !== null) window.clearTimeout(hideTimer);
			hideTimer = window.setTimeout(() => {
				strips.forEach(el => el.removeClass('bt-strip-visible'));
				hideTimer = null;
			}, 80);
		};
		const cancelHide = () => {
			if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
		};

		hooks.showEdgeStrips = () => {
			if (isSwapping?.()) return; // bail if atomic swap is in progress
			cancelHide();
			window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
				if (isSwapping?.()) return; // re-check after two frames
				if (hideTimer !== null) return;
				if (!positionEdgeStrips()) return;
				strips.forEach(el => el.addClass('bt-strip-visible'));
			}));
		};
		hooks.hideEdgeStrips = scheduleHide;

		// Reposition when table geometry changes (column resize, row height change).
		// Follows the table when it grows or shrinks by itself (cell editing adds a line) as well as when a
		// resize says so. It sets the add column's height and the add row's max-width, which can change
		// the layout, so it runs in the phase for that.
		layoutSync.register('reflow', {
			read: () => hooks.isEdgeStripsVisible() ? computeVisibleGeom() : null,
			write: (geom: VisibleGeom | null) => { if (geom) positionEdgeStrips(geom); },
		});

		// Horizontal scroll inside the wrapper doesn't move the wrapper (only the table
		// content within it), so no resize/layout event fires — reposition the edge
		// strips explicitly against the new visible region. Wired below, alongside the
		// selector strips and ctrl column, into ONE shared bindScrollSync call — see
		// its own comment for why these three used to each run an independent listener.
	}
}
