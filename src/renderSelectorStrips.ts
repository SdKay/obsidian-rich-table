/**
 * The strips above and to the left of an editable table: one cell per column and per row, with the column letter
 * and the row number. They select whole rows and columns, offer the operations for a selection, resize columns and
 * rows, and drag rows and columns (and summary rows) to a new place.
 */
import { Menu, Notice, setIcon, type Component } from 'obsidian';
import type { AggType, TableModelV2 } from './model';
import { aggLabel, deleteColsLabel, deleteRowsLabel, hideColsLabel, hideRowsLabel, t } from './i18n';
import { canFreezeCols, canFreezeRows } from './operations';
import { activeAggTypes } from './renderAggregate';
import { copyRangeAsMarkdown, copyRangeToClipboard } from './renderClipboard';
import { selectorAxisOffset, type VisibleGeom } from './renderGeometry';
import { colId, rowId } from './renderGridHelpers';
import { showMenuPinned } from './renderHoverPin';
import { ownCells, ownCols, ownRows } from './renderOwnScope';
import { buildAlignCellOp, openCellPanel, withEdits, type CellOpEntry } from './renderPanel';
import { liftBlock, type BlockLift } from './renderReorderDrag';
import { bindResizeHandle, setupColResize } from './renderResize';
import { bindScrollSync } from './renderScrollSync';
import { hasRowSpanningMerge, sortRowsByColumn } from './renderSort';
import { axisSpans, blockFloor, blockReorderBlocker } from './reorderPlan';
import { SEL_UNIT } from './selectorLayout';
import { colIndexToLetter } from './utils';
import type { ChoiceRegistry } from './choiceRegistry';
import type { TableEdits, TableOpType } from './tableEdits';
import { sameRowGeometry, stripsToRebuild, type RowGeometry, type StripAxis } from './stripRebuildPlan';
import type { LayoutSync } from './layoutSync';
import { columnWraps } from './wrap';

/** Every operation the strips can lead to; they are drawn when the table can do one of them. */
export const SELECTOR_STRIP_OPS: readonly TableOpType[] = [
	'set-col-width', 'set-row-height', 'move-col', 'move-cols', 'move-row', 'move-rows', 'reorder-rows', 'reorder-aggregate',
	'clear-aggregate', 'toggle-aggregate', 'set-sort', 'set-freeze-cols', 'set-freeze-rows', 'insert-col', 'insert-row',
	'hide-col', 'hide-row', 'delete-col', 'delete-row', 'set-col-align', 'set-col-wrap', 'fill-cells', 'set-range-style',
];

export interface RenderSelectorStripsContext {
	model: TableModelV2;
	getRegistry: () => ChoiceRegistry;
	component: Component;
	edits: TableEdits;
	registry: ChoiceRegistry;
	hooks: { hideSelectors: () => void; showSelectors: () => void; isEdgeStripsVisible: () => boolean; liftTitle: () => void; markStripsStale: (axis?: StripAxis) => void; prepareLayout: () => void; restoreLayout: () => void; repositionCtrlCol: (geom?: VisibleGeom) => void; repositionEdgeStrips: (geom?: VisibleGeom) => void; repositionSelectorStrips: (geom?: VisibleGeom) => void; stripCellBusy: () => boolean; updateOuterFrame: () => void };
	root: HTMLElement;
	view: { zoom: number };
	wrapper: HTMLElement;
	table: HTMLTableElement;
	computeVisibleGeom: () => VisibleGeom;
	layoutSync: LayoutSync;
	topStripPad: number;
	reserveLeftPad: () => void;
	clearSel: () => void;
	autoFillOp: (axis: 'row' | 'col', lo: number, hi: number) => CellOpEntry | undefined;
	thead: HTMLElement;
	tbody: HTMLElement;
}

export function renderSelectorStrips(ctx: RenderSelectorStripsContext): void {
	const { model, getRegistry, component, edits, registry, hooks, root, view, wrapper, table, computeVisibleGeom, layoutSync, reserveLeftPad, clearSel, autoFillOp, thead, tbody } = ctx;
	const TOP_STRIP_PAD = ctx.topStripPad;
	// Drop-indicator helper shared by the strips' Ctrl/Cmd+drag
	// reorder below — clears whatever the last drag frame drew before the next
	// one draws its own, on either axis.
	const clearDropIndicators = () => {
		[...ownRows(thead), ...ownRows(tbody)].forEach(e => e.removeClass('bt-drop-before'));
		ownCells(table).forEach(e => e.removeClass('bt-col-drop-before'));
	};
	const onStructuralOp = edits.run;
	const canMoveCols = edits.canAny(['move-col', 'move-cols']);
	const canMoveRows = edits.canAny(['move-row', 'move-rows']);
	// ── Row / column selector strips (Excel-style whole-row/column selection) ──
	if (edits.canAny(SELECTOR_STRIP_OPS)) {
		// Capture the title element (root's own first child, if present) so we
		// can neutralise its -9px margin while the selector is visible —
		// without this the col-selector strip at root's top overlaps the
		// title's last 9px of content. A direct child query, not a sibling
		// lookup: titleEl lives INSIDE root (so it scales together with the
		// table under zoom), not as root's previous sibling.
		const titleEl = root.querySelector<HTMLElement>(':scope > .bt-table-title');

		const colSel = root.createDiv({ cls: 'bt-col-selector' });
		const rowSel = root.createDiv({ cls: 'bt-row-selector' });
		// Non-frozen cells/grips/resize-handles are parented here instead of
		// directly under colSel/rowSel — see styles.css's own comment above
		// .bt-sel-track for why (one shared transform instead of one per cell).
		// A frozen one stays a direct child of colSel/rowSel, outside the track,
		// so it never inherits the track's scroll-offset transform at all.
		const colTrack = colSel.createDiv({ cls: 'bt-sel-track' });
		const rowTrack = rowSel.createDiv({ cls: 'bt-sel-track' });

		// Persistent resize handles — created once (into the track, the common
		// case), reparented into/out of it in rebuild() below if a column/row's
		// frozen status changes, repositioned every time either way.
		const colResizeHandles = new Map<number, HTMLElement>();
		if (edits.can('set-col-width')) model.columns.forEach((c, ci) => {
			if (c.hidden) return;
			const h = colTrack.createDiv({ cls: 'bt-sel-resize-col', attr: { 'aria-hidden': 'true' } });
			setupColResize(h, table, ci, getRegistry, model, onStructuralOp, component, () => view.zoom);
			colResizeHandles.set(ci, h);
		});
		const rowResizeHandles = new Map<number, HTMLElement>();
		// ri is 0-based v2 index; display index = ri+1 (header is 0)
		if (edits.can('set-row-height')) model.rows.forEach((row, ri) => {
			const displayIdx = ri + 1;
			const h = rowTrack.createDiv({ cls: 'bt-sel-resize-row', attr: { 'aria-hidden': 'true' } });
			bindResizeHandle(
				h, table, `data-row="${displayIdx}"`, '--bt-row-height', 24,
				(height) => void onStructuralOp({ type: 'set-row-height', rowId: row.id, height }),
				component,
				undefined,
				() => view.zoom,
			);
			h.addEventListener('dblclick', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				// Clears the row's own height rather than computing and writing a
				// specific number — a row with no height of its own already hugs its
				// content natively (no --bt-row-height override), so this just drops
				// back to that instead of pinning it to whatever fit at this instant.
				void onStructuralOp({ type: 'set-row-height', rowId: row.id, height: 0 });
			});
			rowResizeHandles.set(ri, h);
		});

		let selAxis: 'col' | 'row' | null = null;
		let selI1 = -1, selI2 = -1;
		let selDragging = false; // true only between pointerdown and pointerup

		// Row/column reordering: Ctrl/Cmd+drag on the selector strip, replacing
		// the old dedicated drag-grip sub-zone (removed alongside the rest of the
		// grip/label split — see selectorLayout.ts's own doc comment). A plain
		// drag on the strip still means "select this range" (selAxis/selI1/selI2
		// above); holding Ctrl/Cmd switches the SAME pointerdown/move/up sequence
		// to "move this one row/column", using reorderAxis/reorderFromIdx/
		// reorderToIdx instead so the two never fight over the same state.
		let reorderAxis: 'col' | 'row' | null = null;
		let reorderFromIdx = -1, reorderToIdx = -1;
		// Summary/aggregate-row reorder shares the same Ctrl/Cmd+drag gesture but
		// keys by AggType (there's no numeric row index for a summary row).
		let reorderAggFrom: AggType | null = null, reorderAggTo: AggType | null = null;

		// Highlight table cells corresponding to the current selector selection.
		// Uses data-sel-stripe to track our additions so we don't clobber the
		// cell drag-to-select highlights: only stripe-tagged cells are touched
		// here, since rebuild() also runs from a ResizeObserver whenever the
		// table's box changes for any reason (e.g. exiting cell-edit mode) and
		// must leave an unrelated, `sel`-driven cell selection alone.
		const updateTableHighlights = () => {
			ownCells(table).forEach(e => {
				if (!e.hasAttribute('data-sel-stripe')) return;
				e.removeAttribute('data-sel-stripe');
				e.removeClass('bt-selected');
			});
			if (selAxis === null) return;
			const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
			ownCells(table).filter(e => {
				const v = parseInt((selAxis === 'col' ? e.dataset.col : e.dataset.row) ?? '-1');
				return v >= lo && v <= hi;
			}).forEach(e => {
				e.setAttribute('data-sel-stripe', '1');
				e.addClass('bt-selected');
			});
		};

		const BOTH: ReadonlySet<StripAxis> = new Set<StripAxis>(['col', 'row']);
		/** Every column's left (relative to the table) and width, in logical px. */
		const readCols = (): number[] => {
			const tableLeft = table.getBoundingClientRect().left;
			const flat: number[] = [];
			for (const c of ownCols(table)) {
				const r = c.getBoundingClientRect();
				flat.push((r.left - tableLeft) / view.zoom, r.width / view.zoom);
			}
			return flat;
		};
		/** Every row's top (relative to the table) and height, in logical px, in the order the rows appear. */
		const readRows = (): { trs: HTMLElement[]; geom: Map<HTMLElement, { top: number; height: number }>; flat: number[] } => {
			const tableTop = table.getBoundingClientRect().top;
			const trs = [...ownRows(thead), ...ownRows(tbody)];
			const geom = new Map<HTMLElement, { top: number; height: number }>();
			const flat: number[] = [];
			for (const tr of trs) {
				const r = tr.getBoundingClientRect();
				const g = { top: (r.top - tableTop) / view.zoom, height: r.height / view.zoom };
				geom.set(tr, g);
				flat.push(g.top, g.height);
			}
			return { trs, geom, flat };
		};
		/** Redraws the cells of the strips named. A strip that was not touched is left as it is. */
		const rebuild = (axes: ReadonlySet<StripAxis> = BOTH) => {
			const doCols = axes.has('col'), doRows = axes.has('row');
			// What is selected is marked on the table's cells and on both strips, so a selection redraws everything.
			if (selAxis !== null || (doCols && doRows)) updateTableHighlights();

			// Every layout read the strips need, taken before the first write below: a read
			// after a write re-lays the table out, and once per column and row that is the
			// cost of this whole function.
			const freezeColsAt = model.freezeCols !== undefined && canFreezeCols(model, model.freezeCols) ? model.freezeCols : undefined;
			const freezeRowsAt = model.freezeRows !== undefined && canFreezeRows(model, model.freezeRows) ? model.freezeRows : undefined;
			const colOffset = new Map<HTMLElement, number>();
			const colWidth = new Map<HTMLElement, number>();
			for (const c of ownCols(table)) {
				colWidth.set(c, c.getBoundingClientRect().width / view.zoom);
				const ci = c.dataset.col;
				if (ci === undefined) continue;
				const frozen = freezeColsAt !== undefined && parseInt(ci) < freezeColsAt;
				colOffset.set(c, selectorAxisOffset(c, 'x', view.zoom, frozen));
			}
			if (doCols) colsBuilt = readCols();
			const rows = doRows ? readRows() : null;
			const rowGeom = rows?.geom ?? new Map<HTMLElement, { top: number; height: number }>();
			const allTrs = rows?.trs ?? [];
			if (rows) rowsBuilt = rows.flat;
			const handleRow = new Map<number, { frozen: boolean; offset: number; height: number }>();
			// The row each number belongs to, found in one pass over the rows rather than a search of the table per handle.
			const trOfRow = new Map<number, HTMLElement>();
			if (doRows) for (const tr of allTrs) {
				const n = parseInt(tr.querySelector<HTMLElement>('[data-row]')?.dataset.row ?? '');
				if (!Number.isNaN(n) && !trOfRow.has(n)) trOfRow.set(n, tr);
			}
			if (doRows) for (const [ri] of rowResizeHandles) {
				// data-row is 1-based (header=0, data rows=1,2,3…); ri is 0-based model index.
				const tr = trOfRow.get(ri + 1);
				if (!tr) continue;
				const frozen = freezeRowsAt !== undefined && ri + 1 <= freezeRowsAt;
				handleRow.set(ri, { frozen, offset: selectorAxisOffset(tr, 'y', view.zoom, frozen), height: tr.getBoundingClientRect().height / view.zoom });
			}

			// Column selector — cells positioned by --cl/--cw relative to the selector's
			// own left edge, which CSS Grid aligns with the table wrapper automatically.
			if (doCols) colSel.querySelectorAll('.bt-sel-cell').forEach(e => e.remove());

			// A frozen column's real table cell doesn't move on horizontal scroll
			// (position:sticky) — its selector-strip label shouldn't either, but a
			// non-frozen cell's parent (.bt-sel-track, below) is transformed to stay
			// visually aligned with content scrolling past underneath. Reported: with
			// column freeze on, the label strip kept scrolling away out from under the
			// column it's supposed to label. Parenting a frozen cell OUTSIDE the track
			// (see the `frozen` ternaries below) is what keeps it still; --cl is
			// already the same table-relative left offset applyFreeze computes into
			// --bt-frozen-left for the real cell, so no separate calculation is needed
			// here, just reusing the existing one.
			const freezeCols = model.freezeCols !== undefined && canFreezeCols(model, model.freezeCols) ? model.freezeCols : undefined;
			const freezeRows = model.freezeRows !== undefined && canFreezeRows(model, model.freezeRows) ? model.freezeRows : undefined;
			if (doCols) for (const c of ownCols(table)) {
				const w = colWidth.get(c) ?? 0;
				if (c.dataset.col !== undefined) {
					// Visible column — one cell per physical column
					const ci = parseInt(c.dataset.col);
					// Frozen cell/grip parents directly under colSel, outside colTrack
					// (see styles.css's .bt-sel-track comment) — see selectorAxisOffset
					// for which coordinate space --cl needs as a result.
					const frozen = freezeCols !== undefined && ci < freezeCols;
					const colX = colOffset.get(c) ?? 0;
					const cell = (frozen ? colSel : colTrack).createDiv({ cls: 'bt-sel-cell', attr: { 'aria-label': t('dragReorderCol') } });
					cell.dataset.idx = String(ci);
					cell.setText(colIndexToLetter(ci));
					cell.setCssProps({ '--cl': `${colX}px`, '--cw': `${w}px` });
					if (frozen) cell.addClass('bt-sel-cell-frozen');
					if (selAxis === 'col') {
						const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
						if (ci >= lo && ci <= hi) cell.addClass('is-sel');
					}
					if (reorderAxis === 'col' && ci === reorderFromIdx) cell.addClass('bt-dragging');
				}
				// Hidden column groups get no selector-strip cell — the in-table
				// bt-col-indicator (§ renderRow) is the single "click to show" entry point.
			}

			// Row selector — cells positioned by --rt/--rh relative to the selector's
			// own top edge, which CSS Grid aligns with the table wrapper automatically.
			if (doRows) rowSel.querySelectorAll('.bt-sel-cell').forEach(e => e.remove());
			// Row selector — one cell per physical row, independent of rowspan merges.
			// Use getBoundingClientRect() for row positions: tr.offsetTop is relative to
			// tr.offsetParent which can be tbody (not table), causing all tbody rows to
			// report offsetTop=0. getBoundingClientRect() always gives viewport coords
			// so subtracting table's top gives the correct table-relative offset.
			for (const tr of allTrs) {
				if (!tr) continue;
				const g = rowGeom.get(tr);
				if (!g) continue;
				// Both operands are visual (getBoundingClientRect); rowTop/rowH feed
				// --rt/--rh below, consumed as logical top/height — divide the
				// difference/size by zoom, same correction shape as
				// scrollContentOffset's own (NO_ZOOM's doc comment).
				const rowTop = g.top;
				const rowH   = g.height;
				if (tr.hasClass('bt-row-indicator')) {
					// Hidden row groups get no selector-strip cell — the in-table
					// row itself is the single "click to show" entry point.
				} else if (tr.dataset.agg) {
					// Summary/aggregate row — a small icon cell (not a row number, this
					// isn't part of model.rows) whose click opens a one-item "remove this
					// summary row" menu. Reorders among summary rows only via the same
					// Ctrl/Cmd+drag convention as real rows/columns, keyed by AggType
					// instead of a numeric index — see reorderAggFrom/-To below.
					const agg = tr.dataset.agg as AggType;
					// Aggregate rows aren't part of model.rows/freezeRows — never frozen,
					// always in the track.
					const cell = rowTrack.createDiv({ cls: 'bt-sel-cell bt-sel-agg-cell', attr: { 'aria-label': t('dragReorderAgg') } });
					cell.dataset.aggIdx = agg;
					setIcon(cell, 'sigma');
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					if (edits.can('clear-aggregate')) cell.addEventListener('click', (e: MouseEvent) => {
						e.stopPropagation();
						const m = new Menu();
						m.addItem(item => {
							item.setTitle(t('clearAggregate')).setIcon('trash');
							item.onClick(() => void onStructuralOp({ type: 'clear-aggregate', agg }));
						});
						showMenuPinned(m, e);
					});
					if (reorderAggFrom === agg) cell.addClass('bt-dragging');
				} else {
					const firstCell = tr.querySelector<HTMLElement>('[data-row]');
					if (!firstCell) continue;
					const ri = parseInt(firstCell.dataset.row ?? '-1');
					if (ri < 0) continue;
					// A frozen row's real cell doesn't move on vertical inner-scroll
					// (position:sticky) — its row-number label shouldn't either. In
					// renderFreeze idx<=freezeRows are frozen (header=0 + first
					// freezeRows data rows); ri here is that same data-row value.
					// Parenting outside rowTrack (see styles.css's .bt-sel-track
					// comment) is what stops it tracking scroll now.
					const rowFrozen = freezeRows !== undefined && ri <= freezeRows;
					const cell = (rowFrozen ? rowSel : rowTrack).createDiv({ cls: 'bt-sel-cell', attr: { 'aria-label': t('dragReorderRow') } });
					cell.dataset.idx = String(ri);
					cell.setText(String(ri + 1));
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					if (rowFrozen) cell.addClass('bt-sel-cell-frozen');
					if (selAxis === 'row') {
						const lo = Math.min(selI1, selI2), hi2 = Math.max(selI1, selI2);
						if (ri >= lo && ri <= hi2) cell.addClass('is-sel');
					}
					if (reorderAxis === 'row' && ri === reorderFromIdx) cell.addClass('bt-dragging');
				}
			}

			// Reposition persistent resize handles (column seam positions, row bottom edges).
			// parseFloat, not parseInt — see the matching comment on the colSel loop above.
			if (doCols) for (const c of ownCols(table)) {
				const dc = c.dataset.col;
				if (dc === undefined) continue;
				const h = colResizeHandles.get(parseInt(dc));
				if (!h) continue;
				// A frozen column's real cell doesn't move on horizontal scroll, so
				// neither may the hover zone that resizes it — reparent it outside
				// colTrack (same partition as the label cells above) instead of
				// letting the track's scroll-tracking transform carry it away from
				// the boundary line it belongs to. Reported before this existed: the
				// resize hover area sitting outside the selector, along the
				// extension of that line.
				const colFrozen = freezeCols !== undefined && parseInt(dc) < freezeCols;
				// Seam sits on the column's RIGHT edge; same frozen/non-frozen split as --cl above.
				h.setCssProps({ '--rx': `${(colOffset.get(c) ?? 0) + (colWidth.get(c) ?? 0)}px` });
				h.toggleClass('bt-sel-cell-frozen', colFrozen);
				const colDesiredParent = colFrozen ? colSel : colTrack;
				if (h.parentElement !== colDesiredParent) colDesiredParent.appendChild(h);
			}
			if (doRows) for (const [ri, h] of rowResizeHandles) {
				const g = handleRow.get(ri);
				if (g) {
					// Row's BOTTOM edge — vertical mirror of the column seams above.
					h.setCssProps({ '--ry': `${g.offset + g.height}px` });
					h.toggleClass('bt-sel-cell-frozen', g.frozen);
					const rowDesiredParent = g.frozen ? rowSel : rowTrack;
					if (h.parentElement !== rowDesiredParent) rowDesiredParent.appendChild(h);
					h.removeClass('bt-sel-resize-hidden');
				} else {
					h.addClass('bt-sel-resize-hidden');
				}
			}
		};

		// The table's size when the strips were last rebuilt, and the strips a drag has said are out of date.
		// Nothing else changes what rebuild() draws without changing that size or going through an op, and an op
		// rebuilds the whole table.
		let built: { w: number; h: number } | null = null;
		/** The rows' tops and heights the row strip was built for. */
		let rowsBuilt: RowGeometry = [];
		/** The columns' lefts and widths the column strip was built for. */
		let colsBuilt: RowGeometry = [];
		const staleAxes = new Set<StripAxis>();
		const tableSize = () => { const r = table.getBoundingClientRect(); return { w: r.width, h: r.height }; };
		/** The strips that are out of date; empty when they are as they were built. */
		const axesToRebuild = () => stripsToRebuild(staleAxes, built, tableSize(), () => !sameRowGeometry(rowsBuilt, readRows().flat), () => !sameRowGeometry(colsBuilt, readCols()));
		const rebuildAndRecordSize = (axes: ReadonlySet<StripAxis> = BOTH) => {
			rebuild(axes);
			staleAxes.clear();
			built = tableSize();
		};
		const rebuildIfResized = () => {
			const axes = axesToRebuild();
			if (axes.size > 0) rebuildAndRecordSize(axes);
		};

		let selHideTimer: number | null = null;
		const scheduleSelHide = () => {
			if (selAxis !== null) return;
			if (selHideTimer) window.clearTimeout(selHideTimer);
			selHideTimer = window.setTimeout(() => {
				colSel.removeClass('bt-strip-visible');
				rowSel.removeClass('bt-strip-visible');
				hooks.restoreLayout();
				selHideTimer = null;
			}, 80);
		};

		// getBoundingClientRect delta is immune to the offsetParent chain: when the wrapper
		// (overflow-x:auto) is treated as offsetParent by some Chrome/Electron versions,
		// table.offsetLeft returns 0 (relative to wrapper) instead of the root-relative
		// centering offset.  The viewport-coordinate subtraction always gives the correct
		// root-relative position regardless of offsetParent.
		// See positionEdgeStrips' own comment on the optional `geom` parameter —
		// same shared-frame purpose, via bindScrollSync below.
		const positionSelectors = (geom: VisibleGeom = computeVisibleGeom()) => {
			const g = geom;
			// Col selector: pinned to the visible top edge, spanning the visible width,
			// clipped (overflow:hidden in CSS). --cs-top uses the visible top (vt) so
			// the column letters stay pinned above the view while the table scrolls
			// vertically (like a sticky column header), instead of scrolling off.
			colSel.setCssProps({
				'--cs-left':  `${g.vl}px`,
				'--cs-top':   `${g.vt - SEL_UNIT}px`,
				'--cs-width': `${g.vw}px`,
			});
			// colTrack's own transform carries the horizontal inner-scroll offset for
			// every non-frozen column cell/grip/resize-handle at once (see styles.css's
			// .bt-sel-track comment). Set directly via style.setProperty, deliberately
			// NOT through a CSS custom property (setCssProps): a custom-property change
			// forces the browser to re-examine style for its WHOLE descendant subtree
			// regardless of which specific descendant (if any) actually reads it —
			// measured at ~9ms for a 300-row table's worth of descendants vs ~0.02ms
			// setting `transform` directly, so routing this specific value through a
			// variable would have defeated the whole point of a shared track transform.
			colTrack.style.setProperty('transform', `translateX(${g.colOffset}px)`);
			// Row selector: pinned just left of the visible left edge, spanning the
			// visible HEIGHT (not the full table), clipped — the exact vertical mirror
			// of the col selector above, rowTrack included. Without --rs-top/height the
			// row numbers scrolled off with the table's top once the view had a
			// vertical scrollbar.
			rowSel.setCssProps({
				'--rs-left':   `${g.vl - SEL_UNIT}px`,
				'--rs-top':    `${g.vt}px`,
				'--rs-height': `${g.vh}px`,
			});
			rowTrack.style.setProperty('transform', `translateY(${g.rowOffset}px)`);
		};
		hooks.repositionSelectorStrips = (geom) => { positionSelectors(geom); };

		// prepareLayout / restoreLayout are called by the proximity handler BEFORE
		// show/hide so that positionEdgeStrips() and positionSelectors() both see
		// the same layout (table already shifted by --bt-sel-pad).
		// Cancel whatever --bt-title-mb-pull the active theme set (bridged onto titleEl in
		// tableBlock.ts) so the title sits flush above the col-selector strip on hover
		// instead of stacking a second gap on top of the theme's own pull-closer value.
		// The theme's value is fixed for this render, so it is read once.
		let titlePull: number | null = null;
		hooks.liftTitle = () => {
			if (!titleEl) return;
			titlePull ??= parseFloat(getComputedStyle(titleEl).getPropertyValue('--bt-title-mb-pull')) || 0;
			titleEl.setCssProps({ '--bt-title-mb-adj': `${-titlePull}px` });
		};
		hooks.prepareLayout = () => {
			// Left-padding reservation (row selector + ctrl column sitting flush-left
			// on a wide table) is shared with the ctrl-column-only, locked-table case —
			// see reserveLeftPad's own doc comment above computeVisibleGeom.
			reserveLeftPad();
			// No right/bottom padding reservation here (there used to be one for each,
			// --bt-sel-pad-right and --bt-add-pad, for addColBtn/addRowBtn back when
			// both protruded past root's own edges as absolute overlays) — both now
			// live inside .bt-table-wrapper as normal-flow sticky elements (addColBtn
			// via the contentRow flex wrapper, addRowBtn directly), fully contained
			// within root's own box already, so nothing needs compensating for.
			root.setCssProps({ '--bt-sel-pad': `${TOP_STRIP_PAD}px` });
			hooks.liftTitle();
			// --bt-sel-pad above just changed root's own rendered height (padding-
			// top) — the outer frame's own geometry is stale the instant that
			// happens. viewFrameResizeObs (which watches for exactly this) won't
			// catch it: ResizeObserver's default box option is content-box, and a
			// padding-only change never touches the content box, only the border
			// box getBoundingClientRect() reports — reported (back when this drove
			// the corner-bracket markers this function has since replaced) as
			// those markers staying frozen at their pre-hover spot until some
			// UNRELATED resize (drag-resizing width/height) forced a real
			// content-box change and they visibly snapped over. Calling this
			// directly, synchronously, alongside the other reposition calls this
			// function already makes, closes that gap without waiting on the
			// observer at all.
			hooks.updateOuterFrame();
		};
		hooks.restoreLayout = () => {
			// --bt-sel-pad (top) is never collapsed back to 0 here, for every
			// table, not just a workbook's — collapsing it on mouseleave
			// shrinks root's own rendered height by the same amount, which can
			// tip Obsidian's own reading-pane scroll container back out of
			// needing a vertical scrollbar it needed a moment ago while
			// hovering (or into needing one it didn't). Either way the pane's
			// available width changes, and since .bt-table-wrapper centers via
			// margin-inline:auto, the table visibly SHIFTS sideways with no
			// change to its own size at all — reported as the whole table
			// sliding left shortly after a hover, entirely outside this
			// plugin's own positioning math (confirmed via logged rects: the
			// table's width never changed, only its left/right edges
			// translating, timed to Obsidian's own pane growing a scrollbar).
			// Every strip that depends on root/wrapper geometry gets
			// repositioned in response (viewFrameResizeObs, above) once that
			// happens, but the shift itself was reported as unacceptable on
			// its own regardless of whether the strips stay in sync — the
			// only way to guarantee it can never happen is to make sure
			// hovering never changes root's own rendered height at all, by
			// reserving this padding permanently instead of toggling it.
			// (Originally only a workbook's sheet-tab-bar got this treatment,
			// to stop it jumping up right as the cursor reached it — same
			// mechanism, just a smaller trigger; every table gets it now.)
			// Left/right padding don't affect root's HEIGHT (only horizontal
			// centering within whatever width IS available), so collapsing
			// --bt-sel-pad-left has no scrollbar-cascade risk to guard against —
			// but it's reserved permanently too now, same as --bt-sel-pad (top),
			// rather than only while hovering: this was originally left
			// hover-only for a wide/flush-left table specifically to avoid a
			// visible shift at rest, on the assumption that no table actually
			// needed it reserved permanently. A NESTED table (rendered inside a
			// cell of another one, via the exact same renderTable() call —
			// nothing here is nested-aware or ever should be) turned out to need
			// exactly that: its own cell is a much smaller, tighter box than the
			// reading pane a top-level table sits in, and the hover-only
			// reserve/collapse cycle read as the whole (already cramped) nested
			// table visibly shifting sideways within it. Reserving it
			// permanently for every table — the same treatment top padding
			// already gets — fixes that without a nested-specific branch; the
			// one-time reserve call for this now runs unconditionally too (see
			// the initial-paint call below), not just from a first hover.
			titleEl?.setCssProps({ '--bt-title-mb-adj': '0px' });
			hooks.updateOuterFrame(); // mirror of prepareLayout's own call — see its comment
		};

		hooks.showSelectors = () => {
			if (selHideTimer) { window.clearTimeout(selHideTimer); selHideTimer = null; }
			// Show the strips IMMEDIATELY (cheap: positionSelectors only reads a
			// couple of rects to place the containers), then do the expensive
			// per-column rebuild() — which re-measures every column, O(cells) —
			// on the next frame. Running rebuild() synchronously before adding the
			// visible class meant the strips didn't appear until it finished, so a
			// wide table felt laggy to hover (reported: "reacts slowly, sometimes
			// I'm near the middle before it shows"). The container is positioned
			// right away; the column letters/grips inside settle one frame later.
			positionSelectors();
			colSel.addClass('bt-strip-visible');
			rowSel.addClass('bt-strip-visible');
			// Re-entering a table that has not changed (the note scrolling it under a
			// resting cursor) finds the strips already built: rebuilding them reads every
			// column's rect, and in a long note each read re-lays out the whole note.
			window.requestAnimationFrame(rebuildIfResized);
		};
		hooks.hideSelectors = scheduleSelHide;

		let selectorPanel: HTMLElement | null = null;
		const closeSelectorPanel = () => {
			selectorPanel?.remove();
			selectorPanel = null;
		};

		const startDrag = (axis: 'col' | 'row', idx: number, e: PointerEvent, wrap: HTMLElement) => {
			closeSelectorPanel();
			clearSel(); // a selector-strip drag replaces any active cell-range selection
			selAxis = null; selI1 = selI2 = -1; // clear old highlight before new drag
			e.stopPropagation(); e.preventDefault();
			wrap.setPointerCapture(e.pointerId);
			selAxis = axis; selI1 = selI2 = idx;
			selDragging = true;
			rebuild();
		};
		const moveDrag = (axis: 'col' | 'row', e: PointerEvent) => {
			if (!selDragging || selAxis !== axis) return;
			const wrap = axis === 'col' ? colSel : rowSel;
			for (const cell of Array.from(wrap.querySelectorAll<HTMLElement>('[data-idx]'))) {
				const r = cell.getBoundingClientRect();
				const hit = axis === 'col'
					? e.clientX >= r.left && e.clientX <= r.right
					: e.clientY >= r.top  && e.clientY <= r.bottom;
				if (hit) {
					const idx = parseInt(cell.dataset.idx ?? '-1');
					if (idx >= 0 && idx !== selI2) { selI2 = idx; rebuild(); }
					break;
				}
			}
		};
		// Row/column reorder via Ctrl/Cmd+drag on the selector strip — see
		// reorderAxis's own declaration above for why this is a separate state
		// triple from selAxis/selI1/selI2 rather than reusing it.
		const startReorder = (axis: 'col' | 'row', idx: number, e: PointerEvent, wrap: HTMLElement) => {
			closeSelectorPanel();
			clearSel();
			selAxis = null; selI1 = selI2 = -1;
			e.stopPropagation(); e.preventDefault();
			wrap.setPointerCapture(e.pointerId);
			reorderAxis = axis; reorderFromIdx = reorderToIdx = idx;
			rebuild();
		};
		const moveReorder = (axis: 'col' | 'row', e: PointerEvent) => {
			if (reorderAxis !== axis) return;
			const wrap = axis === 'col' ? colSel : rowSel;
			for (const cell of Array.from(wrap.querySelectorAll<HTMLElement>('[data-idx]'))) {
				const r = cell.getBoundingClientRect();
				const hit = axis === 'col'
					? e.clientX >= r.left && e.clientX <= r.right
					: e.clientY >= r.top  && e.clientY <= r.bottom;
				if (!hit) continue;
				const idx = parseInt(cell.dataset.idx ?? '-1');
				const floor = axis === 'row' ? 1 : 0; // row 0 is the header, never a reorder target
				if (idx < floor || idx === reorderToIdx) break;
				reorderToIdx = idx;
				clearDropIndicators();
				if (idx !== reorderFromIdx) {
					if (axis === 'col') {
						ownCells(table).filter(c => c.dataset.col === String(idx)).forEach(c => c.addClass('bt-col-drop-before'));
					} else {
						// table, not tbody: the target row may be one a header merge
						// reaches into, hosted in <thead> (see computeHeaderRowSpan).
						ownCells(table).find(c => c.dataset.row === String(idx))?.closest<HTMLElement>('tr')?.addClass('bt-drop-before');
					}
				}
				break;
			}
		};
		const endReorder = (axis: 'col' | 'row') => {
			if (reorderAxis !== axis) return;
			reorderAxis = null;
			clearDropIndicators();
			if (reorderFromIdx >= 0 && reorderToIdx >= 0 && reorderFromIdx !== reorderToIdx) {
				if (axis === 'col') {
					void onStructuralOp({ type: 'move-col', fromColId: colId(model, reorderFromIdx), toColId: colId(model, reorderToIdx) });
				} else {
					void onStructuralOp({ type: 'move-row', fromRowId: rowId(model, reorderFromIdx), toRowId: rowId(model, reorderToIdx) });
				}
			}
			reorderFromIdx = reorderToIdx = -1;
			rebuild();
		};

		// Summary/aggregate-row reorder — same Ctrl/Cmd+drag gesture, keyed by
		// AggType via [data-agg-idx] instead of a numeric row index, so it never
		// interferes with the real-row reorder above.
		const startReorderAgg = (agg: AggType, e: PointerEvent) => {
			closeSelectorPanel();
			clearSel();
			selAxis = null; selI1 = selI2 = -1;
			e.stopPropagation(); e.preventDefault();
			rowSel.setPointerCapture(e.pointerId);
			reorderAggFrom = reorderAggTo = agg;
			rebuild();
		};
		const moveReorderAgg = (e: PointerEvent) => {
			if (!reorderAggFrom) return;
			for (const cell of Array.from(rowSel.querySelectorAll<HTMLElement>('[data-agg-idx]'))) {
				const r = cell.getBoundingClientRect();
				if (e.clientY < r.top || e.clientY > r.bottom) continue;
				const agg = (cell.dataset.aggIdx as AggType | undefined) ?? null;
				if (!agg || agg === reorderAggTo) break;
				reorderAggTo = agg;
				clearDropIndicators();
				if (agg !== reorderAggFrom) {
					ownRows(tbody).find(tr => tr.dataset.agg === agg)?.addClass('bt-drop-before');
				}
				break;
			}
		};
		const endReorderAgg = () => {
			if (!reorderAggFrom) return;
			clearDropIndicators();
			if (reorderAggTo && reorderAggFrom !== reorderAggTo) {
				const order = activeAggTypes(model).filter(a => a !== reorderAggFrom);
				order.splice(order.indexOf(reorderAggTo), 0, reorderAggFrom);
				void onStructuralOp({ type: 'reorder-aggregate', order });
			}
			reorderAggFrom = reorderAggTo = null;
			rebuild();
		};

		// Keyboard counterpart to Ctrl/Cmd+drag reorder — Alt+Shift+Arrow moves
		// the row/column currently selected via the strip one step in that
		// direction (Google Sheets' own binding). Only ever moves by one
		// adjacent step per keypress, matching move-row/move-col's own
		// swap-with-neighbor semantics — never jumps to an absolute index.
		component.registerDomEvent(activeDocument, 'keydown', (evt: KeyboardEvent) => {
			if (!evt.altKey || !evt.shiftKey || selAxis === null) return;
			if (selI1 !== selI2) return; // only a single selected row/col has an unambiguous "one step"
			const rowFloor = 1; // row 0 is the header, never a move target
			if (selAxis === 'row' && canMoveRows && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
				evt.preventDefault();
				const toIdx = selI1 + (evt.key === 'ArrowUp' ? -1 : 1);
				if (toIdx < rowFloor || toIdx >= model.rows.length + 1) return;
				void onStructuralOp({ type: 'move-row', fromRowId: rowId(model, selI1), toRowId: rowId(model, toIdx) });
				selI1 = selI2 = toIdx;
				rebuild();
			} else if (selAxis === 'col' && canMoveCols && (evt.key === 'ArrowLeft' || evt.key === 'ArrowRight')) {
				evt.preventDefault();
				const toIdx = selI1 + (evt.key === 'ArrowLeft' ? -1 : 1);
				if (toIdx < 0 || toIdx >= model.columns.length) return;
				void onStructuralOp({ type: 'move-col', fromColId: colId(model, selI1), toColId: colId(model, toIdx) });
				selI1 = selI2 = toIdx;
				rebuild();
			}
		});

		const endDrag = (axis: 'col' | 'row') => {
			if (!selDragging || selAxis !== axis) return;
			selDragging = false;
			const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
			// v2 ID-based targets for selector strip selection
			const target = axis === 'col'
				? (lo === hi ? colId(model, lo) : `${colId(model, lo)}:${colId(model, hi)}`)
				: lo === 0 && hi === 0
					? 'header'
					: lo === hi
						? rowId(model, lo)
						: `${rowId(model, Math.max(lo, 1))}:${rowId(model, hi)}`;

			// Collect cells for live preview
			const els: HTMLElement[] = axis === 'col'
				? ownCells(table).filter(e => { const c = parseInt(e.dataset.col ?? '-1'); return c >= lo && c <= hi; })
				: ownCells(table).filter(e => { const r = parseInt(e.dataset.row ?? '-1'); return r >= lo && r <= hi; });

			const anchor = axis === 'col'
				? (ownCells(table).find(e => e.tagName === 'TH' && e.dataset.col === String(hi)) ?? table)
				: (ownCells(table).find(e => e.dataset.row === String(hi)) ?? table);

			const rule = model.styles.find(s => s.target === target);
			const existing = { bg: rule?.bg, color: rule?.color, size: rule?.size };

			// Build hide / delete ops, matching the style of the cell selection panel.
			const copyOps: CellOpEntry[] = [
				{ icon: 'copy', label: t('copyToExcel'),
					action: () => axis === 'col'
						? copyRangeToClipboard(model, 0, model.rows.length, lo, hi)
						: copyRangeToClipboard(model, lo, hi, 0, model.columns.length - 1) },
				{ icon: 'file-text', label: t('copyToMarkdown'),
					action: () => axis === 'col'
						? copyRangeAsMarkdown(model, 0, model.rows.length, lo, hi)
						: copyRangeAsMarkdown(model, lo, hi, 0, model.columns.length - 1) },
			];
			// Sort — single column only (the model supports one sort key), and not
			// while a row-spanning merge exists (see hasRowSpanningMerge). Two modes:
			// "Sort ascending/descending" commits the current order to storage once
			// (rows[] itself changes, no lingering state, drag-reorder stays usable
			// right after); "Keep sorted ..." is the live view — it never touches
			// rows[], persists as model.sort, and disables manual drag-reorder while
			// active since the display order is derived, not stored.
			const sortOps: CellOpEntry[] = (axis === 'col' && lo === hi && !hasRowSpanningMerge(model)) ? (() => {
				const sortColId = colId(model, lo);
				const sortDir = model.sort?.colId === sortColId ? model.sort.dir : null;
				const commitSort = (dir: 'asc' | 'desc') => {
					const sorted = sortRowsByColumn(model.rows, model.columns, sortColId, dir, registry);
					void onStructuralOp({ type: 'reorder-rows', rowIds: sorted.map(r => r.id) });
				};
				return [
					{ emits: ['reorder-rows'], icon: 'arrow-up', label: t('sortAscending'), action: () => commitSort('asc') },
					{ emits: ['reorder-rows'], icon: 'arrow-down', label: t('sortDescending'), action: () => commitSort('desc') },
					{ emits: ['set-sort'], icon: 'repeat', label: (sortDir === 'asc' ? '✓ ' : '') + t('keepSortedAscending'),
						action: () => void onStructuralOp({ type: 'set-sort', sort: { colId: sortColId, dir: 'asc' } }) },
					{ emits: ['set-sort'], icon: 'repeat', label: (sortDir === 'desc' ? '✓ ' : '') + t('keepSortedDescending'),
						action: () => void onStructuralOp({ type: 'set-sort', sort: { colId: sortColId, dir: 'desc' } }) },
					...(sortDir ? [{ emits: ['set-sort'], icon: 'x', label: t('clearLiveSort'),
						action: () => void onStructuralOp({ type: 'set-sort', sort: null }) }] as CellOpEntry[] : []),
				] as CellOpEntry[];
			})() : [];

			// Summary/aggregate statistics — table-wide (not tied to which column is
			// selected; the column strip is just a convenient place to reach the
			// toggle). Sum/avg are common enough to show directly; min/max/count live
			// behind a native Menu flyout ("More") to keep the primary list short.
			// Every click toggles exactly one statistic and closes (this panel, plus
			// the flyout if used) — adding another one means reopening this popup, a
			// deliberate simplicity tradeoff over a persistent checkbox list.
			const aggOps: CellOpEntry[] = axis === 'col' ? (() => {
				const active = new Set(model.aggregate ?? []);
				const toggle = (agg: AggType) => void onStructuralOp({ type: 'toggle-aggregate', agg });
				const mark = (agg: AggType) => active.has(agg) ? '✓ ' : '';
				return [
					{ emits: ['toggle-aggregate'], icon: 'sigma',  label: mark('sum') + t('aggSum'), action: () => toggle('sum') },
					{ emits: ['toggle-aggregate'], icon: 'divide', label: mark('avg') + t('aggAvg'), action: () => toggle('avg') },
					{ emits: ['toggle-aggregate'], icon: 'chevron-right', label: t('aggMore'), action: (evt: MouseEvent) => {
						const moreMenu = new Menu();
						(['min', 'max', 'count'] as AggType[]).forEach(agg => {
							moreMenu.addItem(item => {
								item.setTitle(aggLabel(agg));
								item.setIcon(agg === 'min' ? 'move-down' : agg === 'max' ? 'move-up' : 'hash');
								if (active.has(agg)) item.setChecked(true);
								item.onClick(() => toggle(agg));
							});
						});
						showMenuPinned(moreMenu, evt);
					} },
				];
			})() : [];

			// Insert-before/after moved here from the per-data-cell menu (renderPanel.ts's
			// dataCellOps) — that menu was getting too long, and "insert a row/column
			// relative to this selection" reads more naturally as a selector-strip action.
			const afterLeft  = lo > 0 ? (model.columns[lo - 1]?.id ?? null) : null;
			const afterRight = model.columns[hi]?.id ?? null;
			const afterAbove = lo > 1 ? (model.rows[lo - 2]?.id ?? null) : null;
			const afterBelow = model.rows[hi - 1]?.id ?? null;

			// Freeze up to the LAST selected row/column — matches Excel's own
			// "select a row/column, Freeze Panes freezes everything above/left
			// of it" convention. Row display indices are already 1-based with
			// the header as an implicit 0 (see rowId()), so `hi` IS the freeze
			// count directly (freeze header + data rows 1..hi); columns are
			// 0-based, so the count of columns 0..hi is hi+1. Rejected up front
			// (Notice, no op dispatched) rather than silently no-opping if it
			// would split a merge across the boundary — see canFreezeRows/Cols.
			const freezeColOps: CellOpEntry[] = [
				{ emits: ['set-freeze-cols'], icon: 'pin', label: t('freezeUpToCol'),
					action: () => {
						const count = hi + 1;
						if (!canFreezeCols(model, count)) { new Notice(t('freezeBlockedByMerge')); return; }
						void onStructuralOp({ type: 'set-freeze-cols', count });
					} },
				...(model.freezeCols !== undefined ? [{ emits: ['set-freeze-cols'], icon: 'pin-off', label: t('unfreezeCols'),
					action: () => void onStructuralOp({ type: 'set-freeze-cols', count: null }) } as CellOpEntry] : []),
			];
			const freezeRowOps: CellOpEntry[] = [
				{ emits: ['set-freeze-rows'], icon: 'pin', label: lo === 0 && hi === 0 ? t('freezeHeaderOnly') : t('freezeUpToRow'),
					action: () => {
						const count = lo === 0 && hi === 0 ? 0 : hi;
						if (!canFreezeRows(model, count)) { new Notice(t('freezeBlockedByMerge')); return; }
						void onStructuralOp({ type: 'set-freeze-rows', count });
					} },
				...(model.freezeRows !== undefined ? [{ emits: ['set-freeze-rows'], icon: 'pin-off', label: t('unfreezeRows'),
					action: () => void onStructuralOp({ type: 'set-freeze-rows', count: null }) } as CellOpEntry] : []),
			];

			const fill = autoFillOp(axis, lo, hi);
			const fillOps: CellOpEntry[] = fill ? [{ divider: true }, fill] : [];

			const cellOps: CellOpEntry[] = withEdits(axis === 'col' ? [
				{ emits: ['insert-col'], icon: 'arrow-left',  label: t('insertColBefore'),
					action: () => void onStructuralOp({ type: 'insert-col', afterColId: afterLeft }) },
				{ emits: ['insert-col'], icon: 'arrow-right', label: t('insertColAfter'),
					action: () => void onStructuralOp({ type: 'insert-col', afterColId: afterRight }) },
				{ divider: true },
				{ emits: ['hide-col'], icon: 'eye-off', label: hideColsLabel(lo, hi, colIndexToLetter),
					action: () => { for (let ci = lo; ci <= hi; ci++) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
				{ emits: ['delete-col'], icon: 'trash',   label: deleteColsLabel(lo, hi, colIndexToLetter), danger: true,
					action: () => { for (let ci = hi; ci >= lo; ci--) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
				{ divider: true },
				// Whole-column default — covers every row in the column, including
				// ones added later (applyColStyle/resolveStylesV2's fallback), unlike
				// the header cell's own align (renderCell.ts) or a data cell/range's
				// own align, which only override this default for their own scope.
				{ ...buildAlignCellOp(model.columns[lo]?.align, (align) => {
					for (let ci = lo; ci <= hi; ci++) {
						const id = colId(model, ci);
						if (id) void onStructuralOp({ type: 'set-col-align', colId: id, align });
					}
				}), emits: ['set-col-align'] },
				// Named after what it does to the first selected column; it sets every selected column the same way.
				// The value it writes clears the column's own setting where that matches the table's.
				(() => {
					const first = model.columns[lo];
					const wraps = first ? columnWraps(first, model) : true;
					const tableWraps = model.wrap ?? true;
					const next = !wraps;
					return { emits: ['set-col-wrap'], icon: next ? 'wrap-text' : 'text', label: next ? t('wrapTextCol') : t('noWrapTextCol'),
						action: () => {
							for (let ci = lo; ci <= hi; ci++) {
								const id = colId(model, ci);
								if (id) void onStructuralOp({ type: 'set-col-wrap', colId: id, wrap: next === tableWraps ? null : next });
							}
						} };
				})(),
				...fillOps,
				...(sortOps.length > 0 ? [{ divider: true } as CellOpEntry, ...sortOps] : []),
				...(aggOps.length > 0 ? [{ divider: true } as CellOpEntry, ...aggOps] : []),
				{ divider: true },
				...freezeColOps,
				{ divider: true },
				...copyOps,
			] : lo === 0 && hi === 0 ? [...copyOps, { divider: true }, ...freezeRowOps] : [  // no hide/delete for header row
				{ emits: ['insert-row'], icon: 'arrow-up',   label: t('insertRowAbove'),
					action: () => void onStructuralOp({ type: 'insert-row', afterRowId: afterAbove }) },
				{ emits: ['insert-row'], icon: 'arrow-down', label: t('insertRowBelow'),
					action: () => void onStructuralOp({ type: 'insert-row', afterRowId: afterBelow }) },
				{ divider: true },
				{ emits: ['hide-row'], icon: 'eye-off', label: hideRowsLabel(lo, hi),
					action: () => { for (let ri = lo; ri <= hi; ri++) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
				{ emits: ['delete-row'], icon: 'trash',   label: deleteRowsLabel(lo, hi), danger: true,
					action: () => { for (let ri = hi; ri >= lo; ri--) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
				...fillOps,
				{ divider: true },
				...freezeRowOps,
				{ divider: true },
				...copyOps,
			], edits);

			// Keep selAxis/selI1/selI2 so highlights stay visible while the panel is open.
			// They are cleared in onClose so the highlight disappears when the panel closes.
			closeSelectorPanel();
			rebuild(); // re-render strip cells with is-sel, keep table highlights

			selectorPanel = openCellPanel({
				component,
				anchor, els,
				styleTarget: target,
				existingStyle: existing,
				inheritedStyle: {},
				showTextColor: true,
				cellOps,
				styleEditable: edits.can('set-range-style'),
				onApplyStyle: (bg, color, size, bold, italic) => void onStructuralOp({ type: 'set-range-style', target, bg, color, size, bold, italic }),
				onClose: () => {
					selectorPanel = null;
					selAxis = null; selI1 = selI2 = -1;
					rebuild(); // clears table highlights and strip is-sel
				},
			});
		};

		// Ctrl/Cmd held on pointerdown routes the whole drag to the reorder path
		// instead of range-selection — see reorderAxis's own declaration above.
		// Long-press inside the CURRENT selection lifts the whole selected block
		// (liftBlock); a press that moves or releases early falls back to the
		// ordinary select-drag / click.
		const LONG_PRESS_MS = 350, LONG_PRESS_SLOP = 4;
		let pressed: { axis: 'col' | 'row'; idx: number; lo: number; hi: number; evt: PointerEvent; wrap: HTMLElement; timer: number } | null = null;
		let lift: { axis: 'col' | 'row'; lo: number; hi: number; handle: BlockLift; wrap: HTMLElement } | null = null;
		const pressPos = (axis: 'col' | 'row', e: PointerEvent) => axis === 'col' ? e.clientX : e.clientY;

		const beginLift = () => {
			if (!pressed) return;
			const { axis, wrap, evt, lo, hi } = pressed;
			pressed = null;
			closeSelectorPanel();
			const count = axis === 'col' ? model.columns.length : model.rows.length + 1;
			lift = { axis, lo, hi, wrap, handle: liftBlock(table, axis, lo, hi, count, pressPos(axis, evt), view.zoom, blockFloor(model, axis), axisSpans(model, axis)) };
			wrap.addClass('bt-reorder-armed');
		};
		const releasePress = (): typeof pressed => {
			const p = pressed;
			if (p) window.clearTimeout(p.timer);
			pressed = null;
			return p;
		};
		const pressAsSelectDrag = (p: NonNullable<typeof pressed>) => {
			startDrag(p.axis, p.idx, p.evt, p.wrap);
		};
		const tryArmLift = (axis: 'col' | 'row', idx: number, e: PointerEvent, wrap: HTMLElement): boolean => {
			if (selAxis !== axis || selDragging) return false;
			const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
			if (idx < lo || idx > hi) return false;
			const blocker = blockReorderBlocker(model, axis, lo, hi);
			if (blocker === 'header') return false;
			e.stopPropagation(); e.preventDefault();
			wrap.setPointerCapture(e.pointerId);
			const onHold = blocker ? () => new Notice(t(`reorderBlocked_${blocker}`)) : beginLift;
			pressed = { axis, idx, lo, hi, evt: e, wrap, timer: window.setTimeout(onHold, LONG_PRESS_MS) };
			return true;
		};
		const movePress = (axis: 'col' | 'row', e: PointerEvent) => {
			if (lift?.axis === axis) { lift.handle.move(pressPos(axis, e)); return; }
			const p = pressed;
			if (!p || p.axis !== axis) return;
			if (Math.hypot(e.clientX - p.evt.clientX, e.clientY - p.evt.clientY) <= LONG_PRESS_SLOP) return;
			releasePress();
			pressAsSelectDrag(p);
			moveDrag(axis, e);
		};
		const endPress = (axis: 'col' | 'row'): boolean => {
			if (lift?.axis === axis) {
				const { lo, hi, handle, wrap } = lift;
				lift = null;
				wrap.removeClass('bt-reorder-armed');
				const slot = handle.drop();
				if (slot !== null) {
					const size = hi - lo + 1;
					if (axis === 'col') {
						const ids = Array.from({ length: size }, (_, k) => colId(model, lo + k));
						void onStructuralOp({ type: 'move-cols', colIds: ids, beforeColId: slot < model.columns.length ? colId(model, slot) : null });
					} else {
						const ids = Array.from({ length: size }, (_, k) => rowId(model, lo + k));
						void onStructuralOp({ type: 'move-rows', rowIds: ids, beforeRowId: slot <= model.rows.length ? rowId(model, slot) : null });
					}
					selI1 = slot > hi ? slot - size : slot;
					selI2 = selI1 + size - 1;
				}
				return true;
			}
			const p = releasePress();
			if (!p || p.axis !== axis) return false;
			pressAsSelectDrag(p);
			return false;
		};
		const cancelPress = (axis: 'col' | 'row') => {
			releasePress();
			if (lift?.axis !== axis) return;
			lift.handle.cancel();
			lift.wrap.removeClass('bt-reorder-armed');
			lift = null;
		};

		colSel.addEventListener('pointerdown', (e: PointerEvent) => {
			const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
			const idx = parseInt(cell?.dataset.idx ?? '-1');
			if (idx < 0) return;
			if (e.ctrlKey || e.metaKey) { if (canMoveCols) startReorder('col', idx, e, colSel); }
			else if (!(canMoveCols && tryArmLift('col', idx, e, colSel))) startDrag('col', idx, e, colSel);
		});
		colSel.addEventListener('pointermove', (e: PointerEvent) => { movePress('col', e); moveDrag('col', e); moveReorder('col', e); });
		colSel.addEventListener('pointerup', () => { if (endPress('col')) return; endDrag('col'); endReorder('col'); });
		colSel.addEventListener('pointercancel', () => cancelPress('col'));

		rowSel.addEventListener('pointerdown', (e: PointerEvent) => {
			const aggCell = (e.target as HTMLElement).closest<HTMLElement>('[data-agg-idx]');
			if (aggCell?.dataset.aggIdx) {
				if ((e.ctrlKey || e.metaKey) && edits.can('reorder-aggregate')) startReorderAgg(aggCell.dataset.aggIdx as AggType, e);
				return;
			}
			const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
			const idx = parseInt(cell?.dataset.idx ?? '-1');
			if (idx < 0) return;
			if (e.ctrlKey || e.metaKey) { if (canMoveRows) startReorder('row', idx, e, rowSel); }
			else if (!(canMoveRows && tryArmLift('row', idx, e, rowSel))) startDrag('row', idx, e, rowSel);
		});
		rowSel.addEventListener('pointermove', (e: PointerEvent) => { movePress('row', e); moveDrag('row', e); moveReorder('row', e); moveReorderAgg(e); });
		rowSel.addEventListener('pointerup', () => { if (endPress('row')) return; endDrag('row'); endReorder('row'); endReorderAgg(); });
		rowSel.addEventListener('pointercancel', () => cancelPress('row'));

		// The strips follow the layout like everything else. The cells are rebuilt only when the table is not
		// the size they were last built for, and not while one of them is being dragged or held (a rebuild
		// replaces every cell, which would take the one under the pointer away). A resize that says so
		// (a column dragged, the page zoomed) makes the cells stale even when the table's size is the same.
		const stripsShown = () => colSel.hasClass('bt-strip-visible') || rowSel.hasClass('bt-strip-visible');
		layoutSync.register('place', {
			read: () => stripsShown() ? computeVisibleGeom() : null,
			write: (geom: VisibleGeom | null) => { if (geom) positionSelectors(geom); },
		});
		layoutSync.register('rebuild', () => {
			if (!stripsShown()) return;
			const axes = axesToRebuild();
			if (axes.size > 0) rebuildAndRecordSize(axes);
		});
		// Without an axis everything is stale; a column or row drag says which strip it moved.
		hooks.markStripsStale = (axis) => { if (axis) staleAxes.add(axis); else built = null; };
		hooks.stripCellBusy = () => selDragging || reorderAxis !== null || pressed !== null;
		// Every way of holding a strip cell ends with the pointer coming up or being cancelled, and the
		// state is cleared by the handlers on the cell first, so the rebuild that waited is done after them.
		const settleAfterPointer = () => window.setTimeout(() => layoutSync.settle(), 0);
		activeDocument.addEventListener('pointerup', settleAfterPointer, true);
		activeDocument.addEventListener('pointercancel', settleAfterPointer, true);
		component?.register(() => {
			activeDocument.removeEventListener('pointerup', settleAfterPointer, true);
			activeDocument.removeEventListener('pointercancel', settleAfterPointer, true);
		});

		// Scroll: repositions the selector strips, the edge-add strips, and the
		// ctrl column — three former independent listeners, each spending 3
		// getBoundingClientRect() reads on the SAME geometry, now merged into one
		// rAF-coalesced frame that reads it once and hands it to all three. See
		// bindScrollSync's own doc comment for the layout-thrashing cost this
		// avoids. Only the containers' own position + each track's transform
		// actually need updating on a pure scroll — the per-cell content stays
		// table-relative and follows those, so no full rebuild() is needed here
		// (keeps scrolling smooth).
		bindScrollSync(
			wrapper, table, root,
			() => colSel.hasClass('bt-strip-visible') || rowSel.hasClass('bt-strip-visible') || hooks.isEdgeStripsVisible(),
			[positionSelectors, hooks.repositionCtrlCol, hooks.repositionEdgeStrips],
			view.zoom,
		);
	}
}
