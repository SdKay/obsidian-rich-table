import { App, Component, Menu, Notice, setIcon } from 'obsidian';
import {
	t, isZh, aggLabel,
	hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel,
	collapsedRowsLabel,
} from './i18n';
import { BUILTIN_THEMES } from './themes/index';
import type { TableModelV2, AggType } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import { colIndexToLetter } from './utils';
import { SEL_TOTAL, AUTOFIT_OFFSET } from './selectorLayout';
import { hasRowSpanningMerge, sortRowsByColumn, applySortForDisplay } from './renderSort';
import type { OpHandler, ToggleLockHandler, CellChangeHandler, ColTypeChangeHandler, StructuralOpHandler } from './renderTypes';
import { rowId, colId, isRowFiltered, buildOccupied, countVisibleCells, getMergeOrigin } from './renderGridHelpers';
import { cellEffectiveStyle } from './renderCellStyle';
import { copyRangeToClipboard, copyRangeAsMarkdown } from './renderClipboard';
import { enterLineEdit } from './renderEditMode';
import { colMinWidth, autoFitAllColWidths, autoFitRowHeight } from './renderAutofit';
import { setupColResize, bindResizeHandle } from './renderResize';
import { type CellOpEntry, openCellPanel } from './renderPanel';
import { renderRow } from './renderCell';
import { renderAggregateRows, activeAggTypes, AGG_ORDER } from './renderAggregate';
import { isHoverPinned, onHoverUnpinned, showMenuPinned } from './renderHoverPin';
import { renderKanbanBoard } from './renderKanban';
import { renderCalendarBoard } from './renderCalendar';
import { renderViewToolbar, buildViewSwitcherMenu } from './renderViews';
import { applyFreeze } from './renderFreeze';
import { canFreezeRows, canFreezeCols } from './operations';

export async function renderTable(
	model: TableModelV2,
	getRegistry: () => ChoiceRegistry,
	container: HTMLElement,
	app: App,
	sourcePath: string,
	component: Component,
	onOp?: OpHandler,
	onToggleLock?: ToggleLockHandler,
	onRootReady?: (root: HTMLElement) => void,
	isSwapping?: () => boolean,
	/** Table identity for renderEditHandoff.ts's cross-rebuild edit resume —
	 *  same key tableBlock.ts's renderCache uses. */
	cacheKey?: string,
	/** Read fresh on each click (not captured once) so toggling the setting takes
	 *  effect on already-rendered tables without a re-render. When it returns true,
	 *  single click enters edit immediately and Ctrl/Cmd+click opens the style panel
	 *  (vs the default single-click-delay / double-click-panel). */
	getSingleClickEdit?: () => boolean,
	/** Left-toolbar "add sheet" button — kept as its own callback (not folded
	 *  into onOp/StructuralOpV2) since converting a plain table into a
	 *  multi-sheet workbook is a WORKBOOK-level action tableBlock.ts handles
	 *  entirely separately from any single sheet's own model. Absent under
	 *  the exact same conditions onStructuralOp itself would be (locked,
	 *  read-only, etc.) — tableBlock.ts derives both from the same guard. */
	onCreateSheet?: () => void,
): Promise<void> {
	if (model.columns.length === 0) return;
	// Sort is a display-only transform: reorder a LOCAL copy of `rows` (never the
	// object the caller holds for write-back) so every existing display-index-based
	// lookup below (rowId(), isRowFiltered(), cellRawValue(), etc.) keeps working
	// unmodified — display index and storage index are the same again after this.
	model = applySortForDisplay(model, getRegistry());
	// Unified op handler — replaces separate onCellChange / onColTypeChange / onStructuralOp.
	// Wrapped as void-returning so helpers typed StructuralOpHandler=(op)=>void are satisfied.
	const onStructuralOp: StructuralOpHandler | undefined = onOp ? (op) => void onOp(op) : undefined;

	// Adapter: row/col-index-based callbacks used by inner helper functions.
	// rowIdx=0 → header (set-col-name); rowIdx≥1 → data cell (set-cell-content).
	const onCellChange: CellChangeHandler | undefined = onOp ? (ri, ci, value) => {
		if (ri === 0) {
			void onOp({ type: 'set-col-name', colId: colId(model, ci), name: value });
		} else {
			// Editing a merge's effective anchor (possibly promoted past a hidden literal
			// anchor, see getMergeOrigin) must write to the merge's literal anchor cell —
			// this row may just be standing in for a hidden anchor and has no data of its own.
			const merge = getMergeOrigin(ri, ci, model);
			const targetRowId = merge?.anchorRowId ?? rowId(model, ri);
			const targetColId = merge?.anchorColId ?? colId(model, ci);
			void onOp({ type: 'set-cell-content', rowId: targetRowId, colId: targetColId, value });
		}
	} : undefined;

	const onColTypeChange: ColTypeChangeHandler | undefined = onOp
		? (ci, colType) => void onOp({ type: 'set-col-type', colId: colId(model, ci), colType })
		: undefined;

	// Snapshot for rendering; getRegistry used in event handlers for fresh lookups
	const registry = getRegistry();

	// Title
	if (model.title) {
		const titleEl = container.createDiv({ cls: 'bt-table-title' });
		titleEl.createSpan({ text: model.title });
		if (onStructuralOp) {
			titleEl.addClass('bt-text-editable');
			titleEl.setAttribute('aria-label', t('clickToEditTitle'));
			titleEl.setAttribute('data-tooltip-position', 'top');
			titleEl.addEventListener('click', () => {
				if (titleEl.hasClass('bt-editing')) return;
				enterLineEdit(titleEl, model.title ?? '', newVal => {
					void onStructuralOp({ type: 'set-title', title: newVal || undefined });
				});
			});
		}
	}

	// Footer — hidden while collapsed, along with the table body. Extracted so
	// both the plain-table path and the Kanban-view early-return (which skips
	// virtually everything else table-specific below) can share it. `parent`
	// defaults to `container` (right for Kanban/Calendar, which have no
	// scrollable wrapper of their own) — the plain-table call site below
	// passes `wrapper` explicitly instead, so the footer lands ABOVE the
	// horizontal scrollbar rather than below root's entire box (reported: with
	// a wide/scrollable table, the footer rendered underneath the scrollbar —
	// container's own bottom edge sits below wrapper's, scrollbar included,
	// so a footer appended there always lands past it, however close or far).
	function renderFooter(parent: HTMLElement = container): void {
		if (!model.footer || model.collapsed) return;
		// Flatten array and split strings on \n so YAML arrays and \n-strings both work
		const rawLines = Array.isArray(model.footer) ? model.footer : [model.footer];
		const lines = rawLines.flatMap(l => l.split('\n'));
		const footerEl = parent.createDiv({ cls: 'bt-table-footer' });
		for (const line of lines) {
			footerEl.createDiv({ cls: 'bt-table-footer-line', text: line });
		}
		if (onStructuralOp) {
			footerEl.addClass('bt-text-editable');
			footerEl.setAttribute('aria-label', t('clickToEditFooter'));
			footerEl.setAttribute('data-tooltip-position', 'top');
			footerEl.addEventListener('click', () => {
				if (footerEl.hasClass('bt-editing')) return;
				const currentText = lines.join('\n');
				enterLineEdit(footerEl, currentText, newVal => {
					if (!newVal) {
						void onStructuralOp({ type: 'set-footer', footer: undefined });
						return;
					}
					const parts = newVal.split('\n').filter(l => l.length > 0);
					void onStructuralOp({
						type: 'set-footer',
						footer: parts.length === 1 ? (parts[0] ?? newVal) : parts,
					});
				}, true /* multiLine */);
			});
		}
	}

	const occupied = buildOccupied(model);
	// Root container with position:relative so all overlay elements (selectors,
	// edge-add strips) can use position:absolute and stay naturally inside
	// Obsidian's content pane — no viewport coordinate math needed.
	const themeClass = model.theme ? `bt-render-root bt-theme-${model.theme}` : 'bt-render-root';
	const root = container.createDiv({ cls: themeClass + (model.collapsed ? ' bt-collapsed' : '') });
	onRootReady?.(root);

	// ── Kanban/Calendar view: an alternate render mode for the SAME rows/
	// columns — see ViewDefV2 in model.ts. Deliberately bails out of the
	// entire plain-table path below (colgroup, selector strips, edge-add
	// strips, resize handles — none of that applies to a lane/card or month-
	// grid layout); only the always-visible mini toolbar (lock + view
	// switcher) and the footer are shared. Checked BEFORE creating `wrapper`
	// so the toolbar can be root's FIRST child (a wrapper created first, then
	// a toolbar appended after, would put the toolbar's title below the
	// board instead of above it). ──
	const activeView = model.views?.find(v => v.id === model.activeViewId);
	if (activeView?.type === 'kanban' || activeView?.type === 'calendar') {
		// viewMain is the region to the RIGHT of the icon column — the wrapper
		// (and its centered title, above it) live inside that, not directly
		// under root, so the title centers over the board's own width rather
		// than the full row including the icon column.
		const viewMain = renderViewToolbar({ root, model, registry, onStructuralOp, onToggleLock, activeView, onCreateSheet });
		const viewWrapper = viewMain.createDiv({ cls: 'bt-table-wrapper' });
		// The wrapper's base width (--bt-wrapper-width, styles.css) defaults to
		// max-content — sized to hug the TABLE's own natural width, so a compact
		// table centers nicely instead of stretching edge-to-edge. A Kanban/
		// Calendar board wants the opposite: fill the available page width
		// first, and only fall back to the board's own horizontal scroll once
		// the lanes/grid genuinely don't fit — so override it to 100% here
		// rather than inheriting the table's hug-content default.
		viewWrapper.setCssProps({ '--bt-wrapper-width': '100%' });
		if (activeView.type === 'kanban') {
			renderKanbanBoard({ model, wrapper: viewWrapper, view: activeView, registry, onStructuralOp });
		} else {
			renderCalendarBoard({ model, wrapper: viewWrapper, root, view: activeView, registry, onStructuralOp, cacheKey: cacheKey ?? '' });
		}
		renderFooter();
		return;
	}

	const wrapper = root.createDiv({ cls: 'bt-table-wrapper' });

	// Apply persisted manual view size (absent = auto: natural width / viewport-
	// capped height, see styles.css). Manual values switch to an exact size.
	if (typeof model.viewWidth === 'number') {
		wrapper.addClass('bt-view-fixed-w');
		wrapper.setCssProps({ '--bt-view-width': `${model.viewWidth}px` });
	}
	if (typeof model.viewHeight === 'number') {
		wrapper.addClass('bt-view-fixed-h');
		wrapper.setCssProps({ '--bt-view-height': `${model.viewHeight}px` });
	}

	// Corner brackets — a quieter, Word-page-style alternative to stretching
	// addRowBtn/the table across dead space to show "this is your manually
	// set width" (reported as ugly). Width only, deliberately: a manually
	// narrower HEIGHT doesn't get the same treatment (not asked for, and less
	// visually confusing to omit than to add a second, orthogonal signal).
	// Not gated behind onStructuralOp — like freeze, this is purely visual
	// and should still tell a read-only viewer their view is manually sized
	// narrower than the space available, not just an editing affordance.
	// Children of `root`, not `wrapper` — see their CSS comment for why
	// (measured: right:/bottom: anchoring from inside wrapper missed by the
	// scrollbar's own width/height whenever one happened to be showing).
	for (const cls of ['bt-view-corner-tl', 'bt-view-corner-tr', 'bt-view-corner-bl', 'bt-view-corner-br']) {
		root.createDiv({ cls: `bt-view-corner ${cls}` });
	}
	const updateViewFrame = () => {
		if (!root.isConnected) return;
		const wr = wrapper.getBoundingClientRect();
		const rr = root.getBoundingClientRect();
		// Only when a manual width is actually narrower than what's available —
		// not merely "a manual width is set" (max-width:100% could already be
		// clamping it back up to fill the same space anyway, in which case
		// there's no distinct "frame" to show), and not for a naturally wide
		// table that needs its own horizontal scroll (no room for corners, and
		// the clipped/scrolling content already makes "this is wide" obvious
		// without them). Also not while locked — a locked table's own view
		// size is effectively frozen alongside everything else about it, so
		// the corners would just be a permanent, un-actionable distraction
		// rather than a cue toward something the user can currently do.
		const framed = typeof model.viewWidth === 'number' && !model.locked && wr.width < rr.width - 0.5;
		root.toggleClass('bt-view-framed', framed);
		if (!framed) return;
		root.setCssProps({
			'--vf-l': `${wr.left - rr.left}px`,
			'--vf-t': `${wr.top - rr.top}px`,
			'--vf-r': `${wr.right - rr.left}px`,
			'--vf-b': `${wr.bottom - rr.top}px`,
		});
	};
	// Deferred: renderTable() still builds into a detached tree at this point
	// (see the write-back architecture notes elsewhere in this file) — root/
	// wrapper report zero-size rects until tableBlock.ts's atomic swap moves
	// this into the live DOM, same reasoning as applyFreeze's own first run.
	window.requestAnimationFrame(updateViewFrame);
	// Needs BOTH rects to stay live: root's own available width changes with
	// the note pane's width (window resize, sidebar toggle, split-pane drag),
	// which doesn't resize wrapper; wrapper's width changes from a drag-resize
	// or "auto-fit columns" shrinking the table, which doesn't resize root.
	// Neither resizes `table` itself (the element every OTHER observer in
	// this file watches), so this needs its own on both. rAF-coalesced,
	// matching the same loop-safety reasoning as freezeResizeObs — cheap (two
	// rect reads + a class toggle), no rebuild.
	//
	// Also the one place that catches root's own available width shrinking
	// AFTER hover already ran (reported: hovering adds --bt-sel-pad, which
	// can push the block's total height past Obsidian's own reading-pane
	// viewport and make IT grow a vertical scrollbar some time later, once
	// Obsidian's own layout pass notices — that pane scrollbar narrows the
	// available width, and since wrapper re-centers within it, the table
	// visibly shifts sideways with no change to its own size at all, which
	// is exactly what this observer (unlike every other one in this file,
	// which watches `table` and only fires on a genuine SIZE change) is
	// positioned to catch: it observes `root`/`wrapper`, not `table`, so a
	// pure re-centering translation with table's size untouched still fires
	// it). The row/col selector strips and ctrl column are positioned from the
	// SAME root/wrapper geometry but were previously only kept in sync by
	// watching `table`'s own resizes — left stranded at their pre-shift
	// position by this exact scenario (confirmed via logged rects: table
	// width constant throughout, only its left/right edges translating,
	// timed to this observer's own fire). Repositioning them here too,
	// alongside updateViewFrame(), closes that gap.
	//
	// Deliberately does NOT also call repositionEdgeStrips() here, unlike
	// those two — positionSelectors()/positionCtrlCol() only write CSS custom
	// properties onto colSel/rowSel/ctrlCol, all three position:absolute (out
	// of flow, can't feed back into their own observed ancestors' size), but
	// positionEdgeStrips() sets addColBtn's height (an in-flow flex item of
	// contentRow) and addRowBtn's max-width (an in-flow sticky child of
	// wrapper) — both CAN change wrapper's own rendered size, which is
	// exactly what this observer watches. Calling it from here closed one
	// gap but opened a real one: wrapper resize -> reposition -> addColBtn/
	// addRowBtn's size changes -> wrapper resizes again -> observer fires
	// again, forever — each round deferred to its own animation frame via
	// the rAF below, which sidesteps the browser's own same-frame
	// ResizeObserver loop-limit protection entirely (that guard only catches
	// reentrancy within a single notify cycle, not a slower loop spread
	// across frames) — reported as Obsidian hanging solid after repeated
	// hover/unhover. addRowBtn/addColBtn's OWN position still tracks
	// correctly regardless (native position:sticky, not JS-computed), so the
	// only cost of leaving their size be here is a possibly-stale height/
	// max-width for one more real resize (table/`resizeObs` already elsewhere
	// in this file, or the next genuine hover) — a minor cosmetic gap, not
	// worth reintroducing a hang to close.
	let viewFrameScheduled = false;
	const viewFrameResizeObs = new ResizeObserver(() => {
		if (viewFrameScheduled) return;
		viewFrameScheduled = true;
		window.requestAnimationFrame(() => {
			viewFrameScheduled = false;
			updateViewFrame();
			repositionSelectorStrips();
			repositionCtrlCol();
		});
	});
	// box:'border-box', not the default content-box — root's rendered size
	// (what getBoundingClientRect(), and therefore updateViewFrame, actually
	// reads) changes on a padding-only update too (hover adds --bt-sel-pad),
	// which never touches the content box and so never fires a content-box
	// observer at all. prepareLayout/restoreLayout already call
	// updateViewFrame() directly for that exact case (synchronous, no need to
	// wait on this observer) — border-box mode here is the general backstop,
	// for any size-affecting change neither of those two functions caused.
	viewFrameResizeObs.observe(root, { box: 'border-box' });
	viewFrameResizeObs.observe(wrapper, { box: 'border-box' });
	component?.register(() => viewFrameResizeObs.disconnect());

	// Drag-resize handles (edit mode only) — dragging the view's OUTER edge
	// (bottom = height, right = width, corner = both), like resizing the whole
	// code-block, not an inner frame around just the table. The handles live on
	// `root` itself (the outermost element we own, which hugs the block) and are
	// pinned to its edges via CSS; a drag live-applies the size to the wrapper
	// (the scroll container) and persists it on release.
	if (onStructuralOp) {
		const makeHandle = (cls: string, mode: 'h' | 'w' | 'both') => {
			const handle = root.createDiv({ cls: `bt-view-resize ${cls}` });
			handle.addEventListener('pointerdown', (e: PointerEvent) => {
				e.preventDefault();
				e.stopPropagation();
				handle.setPointerCapture(e.pointerId);
				const startX = e.clientX, startY = e.clientY;
				const r = wrapper.getBoundingClientRect();
				let newW = r.width, newH = r.height;
				const onMove = (ev: PointerEvent) => {
					if (mode !== 'h') {
						newW = Math.max(80, r.width + (ev.clientX - startX));
						wrapper.addClass('bt-view-fixed-w');
						wrapper.setCssProps({ '--bt-view-width': `${Math.round(newW)}px` });
					}
					if (mode !== 'w') {
						newH = Math.max(60, r.height + (ev.clientY - startY));
						wrapper.addClass('bt-view-fixed-h');
						wrapper.setCssProps({ '--bt-view-height': `${Math.round(newH)}px` });
					}
					// The view's size just changed live, but nothing else re-measures on
					// its own — selectors/edge-add strips/ctrl column are all positioned
					// from cached getBoundingClientRect() deltas computed on hover-enter
					// or scroll, neither of which fires during this drag (reported: they
					// stayed frozen at their pre-drag spot while the view resized under
					// them). Same cheap, rebuild-free reposition calls the scroll listener
					// already uses — no rebuild() needed since column/row COUNT didn't
					// change, only the visible viewport did.
					prepareLayout();
					repositionSelectorStrips();
					repositionEdgeStrips();
					repositionCtrlCol();
				};
				const onUp = () => {
					handle.removeEventListener('pointermove', onMove);
					handle.removeEventListener('pointerup', onUp);
					if (mode !== 'h') void onStructuralOp({ type: 'set-view-width', width: Math.round(newW) });
					if (mode !== 'w') void onStructuralOp({ type: 'set-view-height', height: Math.round(newH) });
				};
				handle.addEventListener('pointermove', onMove);
				handle.addEventListener('pointerup', onUp);
			});
		};
		makeHandle('bt-view-resize-b', 'h');
		makeHandle('bt-view-resize-r', 'w');
		makeHandle('bt-view-resize-br', 'both');
	}

	// contentRow holds <table> and (in edit mode) addColBtn side by side via flex,
	// so addColBtn's height can be a plain `align-self: stretch` matching table's
	// own rendered height instead of a JS measurement — see addColBtn's creation
	// below for the full reasoning (mirrors why addRowBtn is a wrapper-level
	// sticky sibling rather than a root-level absolute overlay).
	const contentRow = wrapper.createDiv({ cls: 'bt-table-content-row' });
	const table = contentRow.createEl('table', { cls: 'bt-table' });

	// Visible-viewport geometry, all in root-relative px. The wrapper (overflow-x:auto)
	// is the horizontal scroll viewport; a wide table scrolls INSIDE it while the wrapper
	// rect itself stays put. All hover strips anchor to this VISIBLE region rather than
	// the (possibly scrolled far off-screen) full table rect, so they behave like a fixed
	// overlay pinned around the visible table on all four sides regardless of scroll.
	//   vl/vt   visible top-left corner        vw/vh   visible width/height
	//   colOffset  how far the table's own left sits left of the visible left (≤ 0) —
	//              added to every column-selector child's left so column letters/grips/
	//              resize seams scroll horizontally in lockstep with the table body and
	//              clip cleanly at the visible edges (overflow:hidden on the col strip).
	const computeVisibleGeom = () => {
		const tr = table.getBoundingClientRect();
		const rr = root.getBoundingClientRect();
		const wr = wrapper.getBoundingClientRect();
		const visLeft   = Math.max(tr.left, wr.left);
		const visRight  = Math.min(tr.right, wr.right);
		const visTop    = Math.max(tr.top, wr.top);
		const visBottom = Math.min(tr.bottom, wr.bottom);
		return {
			tr, rr, wr,
			tt: tr.top - rr.top,              // table top rel root (full, unclamped)
			th: tr.height,
			vl: visLeft - rr.left,            // visible left rel root
			vw: Math.max(0, visRight - visLeft),
			colOffset: tr.left - visLeft,     // ≤ 0 — horizontal inner-scroll offset
			// Vertical mirror of vl/vw/colOffset — the visible band of the table
			// within the (now vertically-scrollable) wrapper. Overlays clamp to
			// this and shift their cells by rowOffset so they track inner vertical
			// scroll, exactly as the column strip tracks inner horizontal scroll.
			vt: visTop - rr.top,              // visible top rel root
			vh: Math.max(0, visBottom - visTop),
			rowOffset: tr.top - visTop,       // ≤ 0 — vertical inner-scroll offset
		};
	};


	// <colgroup> for precise column widths (used when table-layout:fixed).
	// If no column has an explicit width we leave widths unset and let the
	// browser size columns via table-layout:auto (natural content width).
	const HIDDEN_COL_WIDTH = 28;
	const colgroup = table.createEl('colgroup');
	const visibleCols: { colEl: HTMLElement; colIdx: number }[] = [];
	// Determine whether to use fixed layout: any visible column has an explicit width.
	const hasExplicitWidths = model.columns.some(
		col => col && !col.hidden && (col.width ?? 0) > 0,
	);
	let totalWidth = 0;
	for (let ci = 0; ci < model.columns.length; ci++) {
		const col = model.columns[ci];
		if (col?.hidden) {
			while (ci < model.columns.length && model.columns[ci]?.hidden) ci++;
			ci--;
			if (hasExplicitWidths) {
				colgroup.createEl('col').style.setProperty('width', `${HIDDEN_COL_WIDTH}px`);
				totalWidth += HIDDEN_COL_WIDTH;
			} else {
				colgroup.createEl('col');
			}
			continue;
		}
		if (!col) continue;
		const colEl = colgroup.createEl('col');
		colEl.dataset.col = String(ci);
		if (hasExplicitWidths) {
			const w = Math.max(colMinWidth(col, registry), col.width ?? 120);
			colEl.style.setProperty('width', `${w}px`);
			totalWidth += w;
		}
		visibleCols.push({ colEl, colIdx: ci });
	}
	if (hasExplicitWidths) {
		// Switch to fixed layout and pin table width to prevent bloating hidden-col cells.
		// setAttribute is used because setCssProps only handles custom properties and
		// table-layout/width are standard properties that must override the stylesheet.
		table.setAttribute('style', `table-layout:fixed;width:${totalWidth}px`);
		if (onToggleLock) root.setCssProps({ '--bt-lock-table-w': `${totalWidth}px` });
	}

	// ── Drag-to-select for cell merging ──────────────────────────────────────
	// sel tracks the current drag selection; hasMoved prevents click handlers
	// from opening edit mode when the user dragged across cells.
	const sel = {
		start:    null as { row: number; col: number } | null,
		end:      null as { row: number; col: number } | null,
		dragging: false,
		hasMoved: false,
		ctrlHeld: false,
	};

	const inSel = (row: number, col: number): boolean => {
		if (!sel.start || !sel.end) return false;
		const r1 = Math.min(sel.start.row, sel.end.row);
		const r2 = Math.max(sel.start.row, sel.end.row);
		const c1 = Math.min(sel.start.col, sel.end.col);
		const c2 = Math.max(sel.start.col, sel.end.col);
		return row >= r1 && row <= r2 && col >= c1 && col <= c2;
	};

	const clearSel = () => {
		sel.start = sel.end = null;
		sel.hasMoved = false;
		table.querySelectorAll<HTMLElement>('.bt-selected').forEach(e => e.removeClass('bt-selected'));
	};

	const updateHighlights = () => {
		table.querySelectorAll<HTMLElement>('[data-row][data-col]').forEach(e => {
			const row = parseInt(e.dataset.row ?? '-1');
			const col = parseInt(e.dataset.col ?? '-1');
			if (row >= 0 && col >= 0) e.toggleClass('bt-selected', inSel(row, col));
		});
	};

	let selectionPanel: HTMLElement | null = null;
	const removeSelectionPanel = () => { selectionPanel?.remove(); selectionPanel = null; };

	const showSelectionPanel = () => {
		if (!sel.start || !sel.end || !onStructuralOp) return;
		removeSelectionPanel();

		const r1 = Math.min(sel.start.row, sel.end.row);
		const r2 = Math.max(sel.start.row, sel.end.row);
		const c1 = Math.min(sel.start.col, sel.end.col);
		const c2 = Math.max(sel.start.col, sel.end.col);

		const selectedEls = Array.from(
			table.querySelectorAll<HTMLElement>('[data-row][data-col]'),
		).filter(cell => {
			const row = parseInt(cell.dataset.row ?? '-1');
			const col = parseInt(cell.dataset.col ?? '-1');
			return row >= r1 && row <= r2 && col >= c1 && col <= c2;
		});

		// v2 ID-based range target
		const r1RId = r1 === 0 ? 'header' : rowId(model, r1);
		const r2RId = r2 === 0 ? 'header' : rowId(model, r2);
		const c1CId = colId(model, c1);
		const c2CId = colId(model, c2);
		const rangeTarget = (r1 === r2 && c1 === c2)
			? (r1 === 0 ? `header.${c1CId}` : `${r1RId}.${c1CId}`)
			: `${r1RId}.${c1CId}:${r2RId}.${c2CId}`;

		const anchor = selectedEls[selectedEls.length - 1] ?? table;
		const existingStyle = cellEffectiveStyle(model, r1, c1);

		const isHeaderSel = r1 === 0 && r2 === 0;
		selectionPanel = openCellPanel({
			component,
			anchor,
			els: selectedEls,
			styleTarget: rangeTarget,
			existingStyle,
			showTextColor: true,
			cellOps: [
				{ icon: 'combine', label: t('mergeCells'),
					action: () => void onStructuralOp({ type: 'merge-cells', anchorRowId: r1RId, anchorColId: c1CId, endRowId: r2RId, endColId: c2CId }) },
				// Row ops only for data selections (header row cannot be hidden/deleted)
				...(!isHeaderSel ? [
					{ icon: 'eye-off' as const, label: hideRowsLabel(r1, r2),
						action: () => { for (let ri = r1; ri <= r2; ri++) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
					{ icon: 'trash' as const, label: deleteRowsLabel(r1, r2), danger: true as const,
						action: () => { for (let ri = r2; ri >= r1; ri--) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
				] : []),
				{ icon: 'eye-off', label: hideColsLabel(c1, c2, colIndexToLetter),
					action: () => { for (let ci = c1; ci <= c2; ci++) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
				{ icon: 'trash', label: deleteColsLabel(c1, c2, colIndexToLetter), danger: true,
					action: () => { for (let ci = c2; ci >= c1; ci--) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
				{ divider: true },
				{ icon: 'copy', label: t('copyToExcel'),
					action: () => copyRangeToClipboard(model, r1, r2, c1, c2) },
				{ icon: 'file-text', label: t('copyToMarkdown'),
					action: () => copyRangeAsMarkdown(model, r1, r2, c1, c2) },
			],
			onApplyStyle: (bg, color, size, bold, italic) => void onStructuralOp({ type: 'set-range-style', target: rangeTarget, bg, color, size, bold, italic }),
			onClose: () => { clearSel(); selectionPanel = null; },
		});
	};

	// Delegate drag events on tbody so we don't add listeners to every cell
	// (mousedown/mouseover use the cell's data-row/col attributes)

	const thead = table.createEl('thead');
	const headerTr = thead.createEl('tr');
	await renderRow({
		tr: headerTr, rowIdx: 0, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader: true,
		onCellChange, onColTypeChange, onStructuralOp, cacheKey, getSingleClickEdit,
	});

	const tbody = table.createEl('tbody');

	tbody.addEventListener('mousedown', (evt: MouseEvent) => {
		if (evt.button !== 0) return;
		// Don't interfere when clicking inside an active cell editor —
		// preventDefault would block the browser from placing the cursor
		if ((evt.target as HTMLElement).closest('.bt-editing')) return;
		const td = (evt.target as HTMLElement).closest<HTMLElement>('td[data-row][data-col]');
		if (!td) return;
		const row = parseInt(td.dataset.row ?? '-1');
		const col = parseInt(td.dataset.col ?? '-1');
		if (row < 1 || col < 0) return; // data rows only
		sel.ctrlHeld = evt.ctrlKey || evt.metaKey;
		removeSelectionPanel();
		sel.start    = { row, col };
		sel.end      = { row, col };
		sel.dragging = true;
		sel.hasMoved = false;
		updateHighlights();
		evt.preventDefault();

		// Register mouseup for THIS drag only — re-registered on each mousedown
		activeDocument.addEventListener('mouseup', () => {
			sel.dragging = false;
			if (sel.hasMoved && sel.start && sel.end &&
				(sel.start.row !== sel.end.row || sel.start.col !== sel.end.col)) {
				if (sel.ctrlHeld) {
					// ctrl+select: keep highlight, no popup
				} else {
					showSelectionPanel();
				}
			} else {
				clearSel();
			}
			window.setTimeout(() => {
				sel.hasMoved = false;
				delete table.dataset.wasDragged;
			}, 0);
		}, { once: true });
	});

	tbody.addEventListener('mouseover', (evt: MouseEvent) => {
		if (!sel.dragging) return;
		const td = (evt.target as HTMLElement).closest<HTMLElement>('td[data-row][data-col]');
		if (!td) return;
		const row = parseInt(td.dataset.row ?? '-1');
		const col = parseInt(td.dataset.col ?? '-1');
		if (row < 1 || col < 0) return;
		if (row !== sel.end?.row || col !== sel.end?.col) {
			sel.end = { row, col };
			sel.hasMoved = true;
			table.dataset.wasDragged = ''; // only set on actual movement, not every click
			updateHighlights();
		}
	});

	// ── Header row drag-to-select (for merging header cells) ────────────────
	thead.addEventListener('mousedown', (evt: MouseEvent) => {
		if (evt.button !== 0) return;
		const th = (evt.target as HTMLElement).closest<HTMLElement>('th[data-row][data-col]');
		if (!th) return;
		const col = parseInt(th.dataset.col ?? '-1');
		if (col < 0) return;
		removeSelectionPanel();
		sel.ctrlHeld = evt.ctrlKey || evt.metaKey;
		sel.start    = { row: 0, col };
		sel.end      = { row: 0, col };
		sel.dragging = true;
		sel.hasMoved = false;
		updateHighlights();
		evt.preventDefault();

		activeDocument.addEventListener('mouseup', () => {
			sel.dragging = false;
			if (sel.hasMoved && sel.start && sel.end && sel.start.col !== sel.end.col) {
				if (!sel.ctrlHeld) showSelectionPanel();
			} else {
				clearSel();
			}
			window.setTimeout(() => { sel.hasMoved = false; delete table.dataset.wasDragged; }, 0);
		}, { once: true });
	});

	thead.addEventListener('mouseover', (evt: MouseEvent) => {
		if (!sel.dragging || sel.start?.row !== 0) return;
		const th = (evt.target as HTMLElement).closest<HTMLElement>('th[data-row][data-col]');
		if (!th) return;
		const col = parseInt(th.dataset.col ?? '-1');
		if (col < 0) return;
		if (col !== sel.end?.col) {
			sel.end = { row: 0, col };
			sel.hasMoved = true;
			table.dataset.wasDragged = '';
			updateHighlights();
		}
	});

	// ── Row/cell hover highlight (merge-aware) ──────────────────────────────
	// Can't be native CSS :hover: a rowspanned cell's <td> physically lives in only
	// the FIRST <tr> it visually spans, so `tr:hover` alone can never light up
	// the rows underneath it.
	//
	// Modeled as a horizontal sweep through the hovered cell's own row band
	// (just its own row if unmerged, or every row a rowspanned hovered cell
	// itself covers): every cell IN that band gets fully row-highlighted
	// (including any OTHER column's merge that happens to live there, which
	// paints its own full height automatically via its rowSpan) — but a merge
	// anchored OUTSIDE the band that merely reaches INTO it (from an earlier
	// row, since a covered row never has its own <td> for that column) only
	// gets itself highlighted, not its entire row. This was tried first as a
	// transitive "two rows are joined if ANY column's merge covers both, and
	// that can chain" union-find — reported as lighting up the entire table,
	// since two independent merges that each touch the hovered row (one from
	// above, one anchored at it) chained into one another's neighbors too.
	// The sweep only ever looks at the ORIGINAL band, once, with no chaining.
	//
	// Tint applied via inline box-shadow, NOT a CSS class + background rule
	// (the original design) — reported: hovering a frozen cell, or any cell
	// with a user-set per-cell background color, showed no hover tint at all.
	// Root cause: both a frozen cell's opaque fill (renderFreeze.ts's opaqueBg)
	// and a per-cell custom color (applyResolvedStyle) set `background-color`
	// inline with 'important' priority, which always beats a STYLESHEET rule's
	// own !important regardless of specificity — the exact "inline beats any
	// stylesheet !important" invariant this codebase already relies on
	// elsewhere, just working against the hover tint here instead of for it.
	// box-shadow sidesteps this categorically: an inset shadow paints in a
	// later layer than background regardless of who set the background or
	// with what priority, so it's visible no matter what's underneath.
	// hoverShadowBase caches each touched cell's box-shadow *before* hovering
	// touched it (its exact inline value, '' if none) so clearHover can put it
	// back verbatim — needed because a frozen cell's own frame-line shadow, or
	// a theme's own box-shadow decoration (e.g. academic's toprule/midrule),
	// would otherwise be clobbered by the hover layer and never restored.
	const HOVER_CELL_SHADOW = 'inset 0 0 0 999px var(--background-modifier-hover)';
	const HOVER_ROW_SHADOW  = 'inset 0 0 0 999px color-mix(in srgb, var(--background-modifier-hover) 50%, transparent)';
	const hoverShadowBase = new Map<HTMLElement, string>();
	const setHoverShadow = (el: HTMLElement, layer: string) => {
		if (!hoverShadowBase.has(el)) hoverShadowBase.set(el, el.style.getPropertyValue('box-shadow'));
		// Combine with whatever's currently cascading (the cell's own inline
		// value if it has one, else a theme's stylesheet-level box-shadow) —
		// not just the cached inline base — so a theme's decoration also isn't
		// erased for the duration of the hover itself, not only after it ends.
		const computed = getComputedStyle(el).boxShadow;
		const base = computed && computed !== 'none' ? computed : '';
		el.style.setProperty('box-shadow', base ? `${layer}, ${base}` : layer, 'important');
	};
	const clearHover = () => {
		hoverShadowBase.forEach((inlineBase, el) => {
			if (inlineBase) el.style.setProperty('box-shadow', inlineBase, 'important');
			else el.style.removeProperty('box-shadow');
		});
		hoverShadowBase.clear();
	};
	let lastHoverCell: HTMLTableCellElement | null = null;
	table.addEventListener('mouseover', (evt: MouseEvent) => {
		const cell = (evt.target as HTMLElement).closest<HTMLTableCellElement>('.bt-td, .bt-th');
		if (cell === lastHoverCell) return; // moving within the same cell's own nested content
		lastHoverCell = cell;
		clearHover();
		if (!cell) return;
		setHoverShadow(cell, HOVER_CELL_SHADOW);
		const tr = cell.closest<HTMLElement>('tr');
		const container = tr?.parentElement;
		if (!tr || !container) return;
		const trs = Array.from(container.children) as HTMLElement[];
		const bandStart = trs.indexOf(tr);
		if (bandStart < 0) return;
		const bandEnd = bandStart + (cell.rowSpan || 1) - 1;

		trs.forEach((t, i) => {
			if (i >= bandStart && i <= bandEnd) {
				// Fully in the sweep's own band — every cell in this row lights up
				// (the hovered cell itself already has the stronger cell-tint above).
				t.querySelectorAll<HTMLElement>(':scope > .bt-td, :scope > .bt-th')
					.forEach(c => { if (c !== cell) setHoverShadow(c, HOVER_ROW_SHADOW); });
				return;
			}
			// Outside the band — only a cell whose OWN span reaches into the band
			// (an earlier row's merge extending down into it) gets highlighted,
			// and only that one cell, since the sweep doesn't otherwise touch this row.
			Array.from(t.children).forEach(c => {
				const el = c as HTMLTableCellElement;
				if (!el.matches('.bt-td, .bt-th')) return;
				const end = i + (el.rowSpan || 1) - 1;
				if (end >= bandStart && i <= bandEnd) setHoverShadow(el, HOVER_ROW_SHADOW);
			});
		});
	});
	table.addEventListener('mouseleave', () => { lastHoverCell = null; clearHover(); });

	// Click outside the table clears selection and panel
	component.registerDomEvent(activeDocument, 'click', (evt: MouseEvent) => {
		if (!selectionPanel && !sel.start) return;
		if (!(evt.target as HTMLElement).closest('.bt-table-wrapper, .bt-cell-panel')) {
			removeSelectionPanel();
			clearSel();
		}
	});

	// Shared drag-over state — declared here so the drag-and-drop block and the
	// selector-strip block can both read/write the same indicator state.
	let dragOverRow = -1;
	let dragOverCol = -1;
	let dragOverAgg: AggType | null = null;
	const clearDropIndicators = () => {
		table.querySelectorAll<HTMLElement>('.bt-drop-before').forEach(e => e.removeClass('bt-drop-before'));
		table.querySelectorAll<HTMLElement>('.bt-col-drop-before').forEach(e => e.removeClass('bt-col-drop-before'));
	};

	// ── Drag-and-drop row/column reordering ──────────────────────────────────
	if (onStructuralOp) {
		// Row reordering: drop on tbody rows
		tbody.addEventListener('dragover', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes('bt-drag-row')) return;
			evt.preventDefault();
			const tr = (evt.target as HTMLElement).closest<HTMLElement>('tr');
			if (!tr) return;
			const rowIdx = parseInt(tr.querySelector('[data-row]')?.getAttribute('data-row') ?? '-1');
			if (rowIdx < 1 || rowIdx === dragOverRow) return;
			clearDropIndicators();
			dragOverRow = rowIdx;
			tr.addClass('bt-drop-before');
		});

		tbody.addEventListener('drop', (evt: DragEvent) => {
			evt.preventDefault();
			clearDropIndicators();
			const fromStr = evt.dataTransfer?.getData('bt-drag-row');
			if (!fromStr) return;
			const fromIdx = parseInt(fromStr);
			const tr = (evt.target as HTMLElement).closest<HTMLElement>('tr');
			const toIdx = parseInt(tr?.querySelector('[data-row]')?.getAttribute('data-row') ?? '-1');
			if (fromIdx >= 1 && toIdx >= 1 && fromIdx !== toIdx) {
				void onStructuralOp({ type: 'move-row', fromRowId: rowId(model, fromIdx), toRowId: rowId(model, toIdx) });
			}
			dragOverRow = -1;
		});

		// Column reordering: drop on header cells
		thead.addEventListener('dragover', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes('bt-drag-col')) return;
			evt.preventDefault();
			const th = (evt.target as HTMLElement).closest<HTMLElement>('th[data-col]');
			if (!th) return;
			const colIdx = parseInt(th.dataset.col ?? '-1');
			if (colIdx < 0 || colIdx === dragOverCol) return;
			clearDropIndicators();
			dragOverCol = colIdx;
			table.querySelectorAll<HTMLElement>(`[data-col="${colIdx}"]`).forEach(e => e.addClass('bt-col-drop-before'));
		});

		thead.addEventListener('drop', (evt: DragEvent) => {
			evt.preventDefault();
			clearDropIndicators();
			const fromStr = evt.dataTransfer?.getData('bt-drag-col');
			if (!fromStr) return;
			const fromIdx = parseInt(fromStr);
			const th = (evt.target as HTMLElement).closest<HTMLElement>('th[data-col]');
			const toIdx = parseInt(th?.dataset.col ?? '-1');
			if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
				void onStructuralOp({ type: 'move-col', fromColId: colId(model, fromIdx), toColId: colId(model, toIdx) });
			}
			dragOverCol = -1;
		});
	}
	const visibleCellCount = countVisibleCells(model);
	if (model.collapsed) {
		// Collapsed: skip every data row and render one clickable indicator instead —
		// makes the collapsed state obvious at a glance (same pattern as a hidden-row
		// group) rather than an empty-looking table body.
		const indicatorTr = tbody.createEl('tr', { cls: 'bt-collapsed-indicator' });
		const td = indicatorTr.createEl('td', {
			cls: 'bt-row-indicator-cell',
			attr: { colspan: String(visibleCellCount) },
		});
		td.createSpan({ cls: 'bt-indicator-arrow', text: '▶' });
		td.createSpan({ cls: 'bt-indicator-label', text: ` ${collapsedRowsLabel()}` });
		if (onStructuralOp) {
			td.addEventListener('click', () => void onStructuralOp({ type: 'toggle-collapse' }));
		}
	} else {
		// v2: model.rows[] contains only data rows; iterate 0-based, use displayIdx = ri+1
		let di = 0;
		while (di < model.rows.length) {
			const currentRow = model.rows[di];
			if (!currentRow) { di++; continue; }
			if (currentRow.hidden) {
				// Collect the contiguous hidden-row group (by ID)
				const groupIds: string[] = [];
				while (di < model.rows.length && model.rows[di]?.hidden) {
					groupIds.push(model.rows[di]!.id);
					di++;
				}

				const indicatorTr = tbody.createEl('tr', { cls: 'bt-row-indicator' });
				indicatorTr.dataset.hiddenGroup = JSON.stringify(groupIds);
				const td = indicatorTr.createEl('td', {
					cls: 'bt-row-indicator-cell',
					attr: { colspan: String(visibleCellCount) },
				});
				td.createSpan({ cls: 'bt-indicator-arrow', text: '▶' });
				td.createSpan({ cls: 'bt-indicator-label',
					text: ` ${groupIds.length} hidden row${groupIds.length > 1 ? 's' : ''}` });
				if (onStructuralOp) {
					td.addEventListener('click', () =>
						void onStructuralOp({ type: 'show-row-group', rowIds: groupIds }));
				}
				continue;
			}
			const displayIdx = di + 1; // 1-based: 0 = header
			if (isRowFiltered(displayIdx, model)) { di++; continue; }
			const tr = tbody.createEl('tr');
			await renderRow({
				tr, rowIdx: displayIdx, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader: false,
				onCellChange, onColTypeChange, onStructuralOp, cacheKey, getSingleClickEdit,
			});
			di++;
		}
		renderAggregateRows(tbody, model);
	}

	// TODO: filter status bar ("Showing X of Y rows · Clear filter") — deferred until
	// a unified table status bar is designed that can also host sort info.

	// Inside wrapper (before addRowBtn, see renderFooter's own comment) — NOT
	// container's default, which would land the footer below wrapper's entire
	// box, horizontal scrollbar included.
	renderFooter(wrapper);

	// Shared show/hide hooks for the two hover overlays (edge-add strips + selector
	// strips). Assigned inside their blocks; driven by one proximity handler below.
	//
	// prepareLayout / restoreLayout are called by the proximity handler BEFORE any
	// show/hide call so that ALL position calculations see the same, correct layout.
	// This prevents cascading errors when padding-top changes on root (which shifts
	// the table and would invalidate any positions computed before the change).
	let showEdgeStrips    = () => { /* assigned in edge block */ };
	let hideEdgeStrips    = () => { /* assigned in edge block */ };
	let showSelectors     = () => { /* assigned in selector block */ };
	let hideSelectors     = () => { /* assigned in selector block */ };
	let prepareLayout     = () => { /* assigned in selector block */ };
	let restoreLayout     = () => { /* assigned in selector block */ };
	let repositionLockBtn    = () => { /* assigned in lock-button block */ };
	let repositionAutoFitBtn = () => { /* assigned in auto-fit-button block */ };
	let repositionCtrlCol    = () => { /* assigned in ctrl-column block */ };
	// Cheap, rebuild-free repositioning (no visibility toggle, no per-cell
	// rebuild) — hoisted so the width/height drag-resize handles below can keep
	// the strips tracking the view's live size during a drag, the same way the
	// wrapper's own scroll listener already does for scroll (see those call
	// sites for precedent: they call positionSelectors()/positionEdgeStrips()
	// directly, never showSelectors()/rebuild(), specifically to stay cheap
	// enough to run on every event in a fast-firing loop).
	let repositionSelectorStrips = () => { /* assigned in selector block */ };
	let repositionEdgeStrips     = () => { /* assigned in edge block */ };
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
	let freezeApplyScheduled = false;
	const freezeResizeObs = new ResizeObserver(() => {
		if (freezeApplyScheduled) return;
		freezeApplyScheduled = true;
		window.requestAnimationFrame(() => {
			freezeApplyScheduled = false;
			// Reset any active hover tint FIRST — applyFreeze's own clearCell()
			// unconditionally wipes and rebuilds box-shadow on every frozen cell,
			// with no idea a hover interaction has ALSO been layering a tint into
			// that same property. Without this, a cell mid-hover when applyFreeze
			// happens to re-run (any geometry change — this observer fires on far
			// more than just resize) ends up with clearHover's cached "restore"
			// value now stale relative to the freshly-rebuilt frame lines; the
			// eventual mouseleave then puts back the WRONG value — reported as an
			// intermittent missing seam line between two frozen columns that
			// appeared only after hovering a few times and cleared on a fresh
			// render (a full re-render starts hoverShadowBase empty, so the race
			// needs an actual hover to have happened first). Clearing hover here
			// guarantees clearCell/rebuild always start from a hover-free state;
			// worst case the tint blips off for a frame and reappears on the next
			// mouse move, imperceptible next to a permanently corrupted line.
			clearHover();
			lastHoverCell = null;
			applyFreeze(table, thead, tbody, model);
		});
	});
	freezeResizeObs.observe(table);
	component?.register(() => freezeResizeObs.disconnect());

	// ── Edge-hover add strips (CSS Grid cells inside bt-render-root) ──
	if (onStructuralOp) {
		// Mark root to activate the CSS Grid layout that hosts the selector and
		// edge-add strips around the table wrapper.
		root.addClass('bt-has-strips');
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
		const addRowBtn = wrapper.createDiv({ cls: 'bt-edge-add-row' });
		addRowBtn.createSpan({ cls: 'bt-edge-plus', text: '+' });

		const addColBtn = contentRow.createDiv({ cls: 'bt-edge-add-col' });
		addColBtn.createSpan({ cls: 'bt-edge-plus', text: '+' });

		// Belt-and-suspenders: strip nodes are freshly created so they should never
		// carry bt-strip-visible, but reset it explicitly to guard against any
		// future code path that might clone them.
		const resetStrip = (el: HTMLElement) => el.removeClass('bt-strip-visible');
		resetStrip(addRowBtn);
		resetStrip(addColBtn);

		addRowBtn.addEventListener('click', () =>
			void onStructuralOp({ type: 'insert-row', afterRowId: model.rows[model.rows.length - 1]?.id ?? null }));
		addColBtn.addEventListener('click', () =>
			void onStructuralOp({ type: 'insert-col', afterColId: model.columns[model.columns.length - 1]?.id ?? null }));

		// Use getBoundingClientRect delta — same reason as positionSelectors: the wrapper's
		// overflow-x:auto can make it an offsetParent in some Chrome builds, so offsetTop/
		// offsetLeft traversal may stop at the wrapper instead of reaching root.
		// getBCR viewport-coordinate subtraction is always root-relative and unambiguous.
		const positionEdgeStrips = (): boolean => {
			// Stale-root guard: if this renderTable() closure's root has been removed from
			// the DOM by a subsequent atomic swap, any rect we read would be from an
			// unrelated or detached element — bail immediately.
			if (!root.isConnected) return false;

			const g = computeVisibleGeom();
			const { tr, rr } = g;
			if (tr.width === 0 || tr.height === 0) return false;
			if (rr.width === 0) return false;
			if (rr.height === 0) {
				window.requestAnimationFrame(() => positionEdgeStrips());
				return false;
			}
			// Double-content guard: root height should never exceed the WRAPPER height by
			// more than the maximum padding (sel-pad=32px, so 60px is safe). rr.height >>
			// wrapper height means the DOM contains two stacked roots (cache clone
			// injection window), producing the anomalous rr.height≈1113 in logs.
			// Referencing the WRAPPER (not the table) is deliberate: a wide table adds a
			// horizontal scrollbar (~12-15px) that inflates the wrapper AND root heights
			// equally — comparing against the table height instead used to trip this guard
			// on every scrollable table, silently killing both edge-add buttons.
			if (rr.height > g.wr.height + 60) return false;
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
			addColBtn.setCssProps({ '--strip-height': `${g.vh}px` });
			// addRowBtn needs no JS position math either (sticky handles bottom/
			// left/right — see its own CSS comment), but its --strip-max-width
			// does: caps it to contentRow's (table + addColBtn) rendered width so
			// it matches the table instead of always stretching to the full
			// visible viewport — a no-op for a table that itself needs the full
			// viewport (wide table, horizontal scroll), since the cap then
			// exceeds what left:0/right:0 would render anyway.
			addRowBtn.setCssProps({ '--strip-max-width': `${contentRow.getBoundingClientRect().width}px` });
			// Expose full table geometry so themes can compute table-local cursor coordinates.
			// Themes subtract these from --bt-mx/--bt-my to get cursor position within
			// the table's own coordinate space (e.g. for cursor-glow on row hover) — this
			// stays the ACTUAL table rect (not the clamped visible region) so the math is
			// correct even while scrolled.
			root.setCssProps({
				'--bt-tbl-l': `${tr.left - rr.left}px`,
				'--bt-tbl-t': `${g.tt}px`,
				'--bt-tbl-w': `${tr.width}px`,
				'--bt-tbl-h': `${g.th}px`,
			});
			return true;
		};
		repositionEdgeStrips = () => { positionEdgeStrips(); };

		let hideTimer: number | null = null;
		const scheduleHide = () => {
			if (hideTimer !== null) window.clearTimeout(hideTimer);
			hideTimer = window.setTimeout(() => {
				addRowBtn.removeClass('bt-strip-visible');
				addColBtn.removeClass('bt-strip-visible');
				hideTimer = null;
			}, 80);
		};
		const cancelHide = () => {
			if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
		};

		showEdgeStrips = () => {
			if (isSwapping?.()) return; // bail if atomic swap is in progress
			cancelHide();
			window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
				if (isSwapping?.()) return; // re-check after two frames
				if (hideTimer !== null) return;
				if (!positionEdgeStrips()) return;
				addRowBtn.addClass('bt-strip-visible');
				addColBtn.addClass('bt-strip-visible');
			}));
		};
		hideEdgeStrips = scheduleHide;

		// Reposition when table geometry changes (column resize, row height change).
		table.addEventListener('bt-layout-changed', () => {
			if (addRowBtn.hasClass('bt-strip-visible')) positionEdgeStrips();
		});

		// Also reposition when the table naturally grows/shrinks (e.g. cell editing
		// adds lines via Shift+Enter) — bt-layout-changed is only fired by explicit
		// resize ops, not by the browser's natural reflow.
		//
		// Called directly, not deferred another frame via requestAnimationFrame —
		// see the matching selResizeObs comment (below, for the row/column
		// selector strips) for why: deferring here produced the exact same
		// visible "table resizes, then the +add strip catches up a beat later"
		// during zoom, and calling synchronously is equally safe (only sets CSS
		// custom properties on addRowBtn/addColBtn/root, none of which is the
		// observed table, so no ResizeObserver-loop risk).
		const resizeObs = new ResizeObserver(() => {
			if (addRowBtn.hasClass('bt-strip-visible')) positionEdgeStrips();
		});
		resizeObs.observe(table);
		component?.register(() => resizeObs.disconnect());

		// Horizontal scroll inside the wrapper doesn't move the wrapper (only the table
		// content within it), so no resize/layout event fires — reposition the edge
		// strips explicitly against the new visible region. rAF-coalesced so a burst of
		// scroll events costs at most one reposition per frame.
		let edgeScrollScheduled = false;
		wrapper.addEventListener('scroll', () => {
			if (!addRowBtn.hasClass('bt-strip-visible') && !addColBtn.hasClass('bt-strip-visible')) return;
			if (edgeScrollScheduled) return;
			edgeScrollScheduled = true;
			window.requestAnimationFrame(() => { edgeScrollScheduled = false; positionEdgeStrips(); });
		});
	}

	// ── Control column: lock · autofit · theme · aggregate · collapse — left of the row-drag strip ──
	// All buttons share a vertical flex column positioned just left of the
	// row selector. All but lock need onStructuralOp; lock needs onToggleLock.
	if (onStructuralOp || onToggleLock) {
		const ctrlCol = root.createDiv({ cls: 'bt-ctrl-col' + (model.locked ? ' is-locked' : '') });

		// Lock button — first in column. Hidden while collapsed: only the expand
		// button is shown, since the other buttons act on the now-invisible body.
		if (onToggleLock && !model.collapsed) {
			const lockBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn' + (model.locked ? ' is-locked' : ''),
				attr: {
					'aria-label':            model.locked ? t('unlockTable') : t('lockTable'),
					'data-tooltip-position': 'right',
				},
			});
			setIcon(lockBtn, model.locked ? 'lock' : 'lock-open');
			lockBtn.addEventListener('click', () => void onToggleLock());
			repositionLockBtn = () => { /* handled by ctrlCol */ };
		}

		// Autofit button — second in column. Hidden while collapsed (see lock button above).
		if (onStructuralOp && !model.collapsed) {
			const autoFitBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('autoFitAll'), 'data-tooltip-position': 'right' },
			});
			setIcon(autoFitBtn, 'maximize-2');
			autoFitBtn.addEventListener('click', () => {
				const cols = visibleCols
					.map(({ colIdx }) => {
						const col = model.columns[colIdx];
						return col ? { colIdx, minW: colMinWidth(col, getRegistry()) } : null;
					})
					.filter((c): c is { colIdx: number; minW: number } => c !== null);
				const fits = autoFitAllColWidths(table, cols);
				for (const { colIdx } of cols) {
					const col = model.columns[colIdx];
					if (!col) continue;
					void onStructuralOp({ type: 'set-col-width', colId: col.id, width: fits.get(colIdx) ?? colMinWidth(col, getRegistry()) });
				}
				for (const row of model.rows) {
					void onStructuralOp({ type: 'set-row-height', rowId: row.id, height: 0 });
				}
			});
			repositionAutoFitBtn = () => { /* positioning handled by ctrlCol */ };
		}

		// Theme picker button — third in column. Hidden while collapsed (see lock button above).
		if (onStructuralOp && !model.collapsed) {
			const THEMES: { id: string | null; label: string }[] = [
				{ id: null, label: t('themeDefault') },
				...BUILTIN_THEMES.map(th => ({
					id: th.id,
					label: isZh() ? th.labelZh : th.labelEn,
				})),
			];
			const themeBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('changeTheme'), 'data-tooltip-position': 'right' },
			});
			setIcon(themeBtn, 'palette');
			themeBtn.addEventListener('click', (evt: MouseEvent) => {
				const menu = new Menu();
				for (const { id, label } of THEMES) {
					menu.addItem(item => {
						item.setTitle(label);
						if ((model.theme ?? null) === id) item.setChecked(true);
						item.onClick(() => void onStructuralOp({ type: 'set-theme', theme: id }));
					});
				}
				showMenuPinned(menu, evt);
			});
		}

		// Summary/aggregate button — fourth in column. Same toggle set as the
		// column-selector popup's Sum/Average/More group (see endDrag('col')) —
		// this is just a second, table-wide-only entry point to the same state,
		// for when the user wants to add a summary row without first selecting
		// a column. Hidden while collapsed (see lock button above).
		if (onStructuralOp && !model.collapsed) {
			const aggBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('aggMore'), 'data-tooltip-position': 'right' },
			});
			setIcon(aggBtn, 'sigma');
			aggBtn.addEventListener('click', (evt: MouseEvent) => {
				const active = new Set(model.aggregate ?? []);
				const menu = new Menu();
				for (const agg of AGG_ORDER) {
					menu.addItem(item => {
						item.setTitle(aggLabel(agg));
						if (active.has(agg)) item.setChecked(true);
						item.onClick(() => void onStructuralOp({ type: 'toggle-aggregate', agg }));
					});
				}
				showMenuPinned(menu, evt);
			});
		}

		// Collapse/expand button — fifth in column
		if (onStructuralOp) {
			const collapseBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: {
					'aria-label':            model.collapsed ? t('expandTable') : t('collapseTable'),
					'data-tooltip-position': 'right',
				},
			});
			setIcon(collapseBtn, model.collapsed ? 'unfold-vertical' : 'fold-vertical');
			collapseBtn.addEventListener('click', () => void onStructuralOp({ type: 'toggle-collapse' }));
		}

		// View settings — auto width/height (reset a manual drag-resize back to
		// auto) + the only entry points for adding a title / footer when the
		// table has none yet (once present, the inline title/footer editors take
		// over). Hidden while collapsed (body/footer aren't shown then).
		if (onStructuralOp && !model.collapsed) {
			const settingsBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('viewSettings'), 'data-tooltip-position': 'right' },
			});
			setIcon(settingsBtn, 'settings-2');
			settingsBtn.addEventListener('click', (evt: MouseEvent) => {
				const menu = new Menu();
				menu.addItem(i => i.setTitle(t('autoWidth')).setIcon('move-horizontal')
					.setChecked(model.viewWidth === undefined)
					.onClick(() => void onStructuralOp({ type: 'set-view-width', width: null })));
				menu.addItem(i => i.setTitle(t('autoHeight')).setIcon('move-vertical')
					.setChecked(model.viewHeight === undefined)
					.onClick(() => void onStructuralOp({ type: 'set-view-height', height: null })));
				if (model.title === undefined) {
					menu.addSeparator();
					menu.addItem(i => i.setTitle(t('addTitle')).setIcon('heading')
						.onClick(() => void onStructuralOp({ type: 'set-title', title: t('titlePlaceholder') })));
				}
				if (!model.footer || (Array.isArray(model.footer) && model.footer.length === 0)) {
					menu.addItem(i => i.setTitle(t('addFooter')).setIcon('panel-bottom')
						.onClick(() => void onStructuralOp({ type: 'set-footer', footer: t('footerPlaceholder') })));
				}
				showMenuPinned(menu, evt);
			});
		}

		// Views switcher — last in column. Shares buildViewSwitcherMenu with the
		// Kanban toolbar's own views button (renderKanban.ts) so both surfaces
		// offer the exact same set of views/actions.
		if (onStructuralOp) {
			const viewsBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('views'), 'data-tooltip-position': 'right' },
			});
			setIcon(viewsBtn, 'layout-grid');
			viewsBtn.addEventListener('click', (evt: MouseEvent) =>
				showMenuPinned(buildViewSwitcherMenu(model, registry, onStructuralOp), evt));
		}

		// Add sheet — converts this table into a multi-sheet workbook (or, once
		// it already is one, appends another sheet). Last in the column; absent
		// once the table already has its own bottom sheet-tab-bar (that bar's
		// own "+" takes over — see tableBlock.ts).
		if (onCreateSheet) {
			const addSheetBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('newSheet'), 'data-tooltip-position': 'right' },
			});
			setIcon(addSheetBtn, 'copy-plus');
			addSheetBtn.addEventListener('click', () => onCreateSheet());
		}


		// Position the column just left of the row selector — anchored to the VISIBLE
		// left edge (not the table's own left) so it stays on-screen when a wide table
		// is horizontally scrolled.
		const positionCtrlCol = () => {
			const g = computeVisibleGeom();
			if (g.tr.width === 0) return;
			// ctrlCol stacks a growing number of buttons (lock/auto-fit/theme/
			// aggregate/collapse/views/add-sheet) with no height cap of its own —
			// for a short table (few rows) that stack is taller than the table
			// itself, so it silently overflows past root's bottom edge and gets
			// clipped by Obsidian's own live-preview widget container (outside
			// this stylesheet's control) instead of just spilling visibly onto
			// the page below. Cap it to the table's own height so it scrolls
			// internally in that case rather than losing buttons off the bottom.
			// Clamp to the VISIBLE band (vt/vh), not the full table (tt/th), so the
			// toolbar stays pinned in view when the table scrolls vertically inside
			// the wrapper instead of scrolling off with the table's top.
			ctrlCol.setCssProps({
				'--cc-top':  `${g.vt + 2}px`,
				'--cc-left': `${g.vl - SEL_TOTAL - AUTOFIT_OFFSET - 4}px`,
				'--cc-maxh': `${Math.max(g.vh - 4, 0)}px`,
			});
		};
		window.requestAnimationFrame(positionCtrlCol);
		table.addEventListener('bt-layout-changed', positionCtrlCol);
		new ResizeObserver(positionCtrlCol).observe(table);
		// A wide table shifted right by --bt-sel-pad-left on hover doesn't change the
		// table's own size (it just overflows less/more), so ResizeObserver won't fire
		// — the mouseenter handler calls this explicitly after prepareLayout instead.
		repositionCtrlCol = positionCtrlCol;
	}

	// ── Row / column selector strips (Excel-style whole-row/column selection) ──
	if (onStructuralOp) {
		// Capture the title element (previous sibling of root, if present) so we can
		// neutralise its -9px margin while the selector is visible — without this the
		// col-selector strip at root's top overlaps the title's last 9px of content.
		const prev = root.previousElementSibling;
		const titleEl = (prev instanceof HTMLElement && prev.hasClass('bt-table-title')) ? prev : null;

		const colSel = root.createDiv({ cls: 'bt-col-selector' });
		const rowSel = root.createDiv({ cls: 'bt-row-selector' });

		// Persistent resize handles — created once, repositioned in rebuild().
		const colResizeHandles = new Map<number, HTMLElement>();
		model.columns.forEach((c, ci) => {
			if (c.hidden) return;
			const h = colSel.createDiv({ cls: 'bt-sel-resize-col', attr: { 'aria-hidden': 'true' } });
			setupColResize(h, table, ci, getRegistry, model, onStructuralOp, component);
			colResizeHandles.set(ci, h);
		});
		const rowResizeHandles = new Map<number, HTMLElement>();
		// ri is 0-based v2 index; display index = ri+1 (header is 0)
		model.rows.forEach((row, ri) => {
			const displayIdx = ri + 1;
			const h = rowSel.createDiv({ cls: 'bt-sel-resize-row', attr: { 'aria-hidden': 'true' } });
			bindResizeHandle(
				h, table, `data-row="${displayIdx}"`, '--bt-row-height', 24,
				(height) => void onStructuralOp({ type: 'set-row-height', rowId: row.id, height }),
				component,
			);
			h.addEventListener('dblclick', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				const fit = autoFitRowHeight(table, displayIdx, 24);
				void onStructuralOp({ type: 'set-row-height', rowId: row.id, height: fit });
			});
			rowResizeHandles.set(ri, h);
		});

		let selAxis: 'col' | 'row' | null = null;
		let selI1 = -1, selI2 = -1;
		let selDragging = false; // true only between pointerdown and pointerup

		// Highlight table cells corresponding to the current selector selection.
		// Uses data-sel-stripe to track our additions so we don't clobber the
		// cell drag-to-select highlights.
		const updateTableHighlights = () => {
			table.querySelectorAll<HTMLElement>('[data-sel-stripe]').forEach(e => {
				e.removeAttribute('data-sel-stripe');
				e.removeClass('bt-selected');
			});
			if (selAxis === null) return;
			const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
			const selector = selAxis === 'col'
				? Array.from({ length: hi - lo + 1 }, (_, i) => `[data-col="${lo + i}"]`).join(',')
				: Array.from({ length: hi - lo + 1 }, (_, i) => `[data-row="${lo + i}"]`).join(',');
			table.querySelectorAll<HTMLElement>(selector).forEach(e => {
				e.setAttribute('data-sel-stripe', '1');
				e.addClass('bt-selected');
			});
		};

		const rebuild = () => {
			updateTableHighlights();

			// In auto layout (no explicit widths, e.g. the empty-block template) the <col>
			// elements never get a width set at render time — see hasExplicitWidths above —
			// so every offset computed below from col.style.width would read 0 and collapse
			// the selector/resize-seam positions to the left edge. Measure each physical
			// column's actual rendered width from an unspanned header/data cell and pin it
			// onto the <col> so the existing col.style.width reads further down stay correct.
			if (!hasExplicitWidths) {
				const measured = new Map<string, number>();
				// A column that's colspan-merged in EVERY row it appears in (e.g. a
				// header merge spanning it plus a different data-row merge also
				// spanning it) never turns up as an unspanned cell anywhere, so the
				// loop below would never measure it — reported as the selector
				// strip's column boundaries drifting off from that column onward,
				// since its <col> kept whatever stale/empty width it had before,
				// collapsing that column's contribution to 0 in the cumulative
				// left-offset sum further down. Colspan cells are still recorded
				// here (not skipped outright) as a fallback candidate — an equal
				// share of the merged cell's own rendered width — applied only to
				// whichever columns never get a precise unspanned measurement.
				const spanned: { startCol: number; span: number; width: number }[] = [];
				const rows = [
					...Array.from(thead.querySelectorAll<HTMLElement>('tr')),
					...Array.from(tbody.querySelectorAll<HTMLElement>('tr')),
				];
				for (const tr of rows) {
					for (const cell of Array.from(tr.querySelectorAll<HTMLTableCellElement>('[data-col]'))) {
						const ci = cell.dataset.col;
						if (ci === undefined) continue;
						if (cell.colSpan > 1) {
							spanned.push({ startCol: parseInt(ci), span: cell.colSpan, width: cell.getBoundingClientRect().width });
							continue;
						}
						if (measured.has(ci)) continue;
						measured.set(ci, cell.getBoundingClientRect().width);
					}
				}
				for (const { startCol, span, width } of spanned) {
					const share = width / span;
					for (let ci = startCol; ci < startCol + span; ci++) {
						const key = String(ci);
						if (!measured.has(key)) measured.set(key, share);
					}
				}
				for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
					const ci = c.dataset.col;
					if (ci === undefined) continue;
					const w = measured.get(ci);
					if (w !== undefined) c.style.setProperty('width', `${w}px`);
				}
			}

			// Column selector — cells positioned by --cl/--cw relative to the selector's
			// own left edge, which CSS Grid aligns with the table wrapper automatically.
			colSel.querySelectorAll('.bt-sel-cell, .bt-sel-col-drag').forEach(e => e.remove());

			// parseFloat, not parseInt: col.style.width holds a fractional px value
			// (rebuild()'s own measurement above pins e.g. "39.9952px" for an
			// auto-layout column) — parseInt truncates that to "39", and doing so
			// on every column in a cumulative running sum compounds the ~1px loss
			// per column into a growing drift, reported as the selector strip's
			// column boundaries visibly falling further behind the table's real
			// columns the further right you go (confirmed via logged real numbers:
			// the drift grew by almost exactly 1px per column). Same fix applied
			// to the resize-handle seam positions below, which summed the same
			// truncated value.
			// A frozen column's real table cell doesn't move on horizontal scroll
			// (position:sticky) — its selector-strip label shouldn't either, but
			// every .bt-sel-cell's `left` normally tracks --cs-off (set to roughly
			// -scrollLeft) to stay visually aligned with content scrolling past
			// underneath. Reported: with column freeze on, the label strip kept
			// scrolling away out from under the column it's supposed to label.
			// bt-sel-cell-frozen (CSS) drops --cs-off from that formula, leaving
			// just --cl — which is already the same table-relative left offset
			// applyFreeze computes into --bt-frozen-left for the real cell, so no
			// separate calculation is needed here, just reusing the existing one.
			const freezeCols = model.freezeCols !== undefined && canFreezeCols(model, model.freezeCols) ? model.freezeCols : undefined;
			const freezeRows = model.freezeRows !== undefined && canFreezeRows(model, model.freezeRows) ? model.freezeRows : undefined;
			let colX = 0;
			for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
				const w = parseFloat(c.style.width) || 0;
				if (c.dataset.col !== undefined) {
					// Visible column — one cell per physical column
					const ci = parseInt(c.dataset.col);
					const cell = colSel.createDiv({ cls: 'bt-sel-cell' });
					cell.dataset.idx = String(ci);
					cell.setText(colIndexToLetter(ci));
					cell.setCssProps({ '--cl': `${colX}px`, '--cw': `${w}px` });
					if (freezeCols !== undefined && ci < freezeCols) cell.addClass('bt-sel-cell-frozen');
					if (selAxis === 'col') {
						const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
						if (ci >= lo && ci <= hi) cell.addClass('is-sel');
					}
					// Drag grip: sibling of sel-cell, lives in the upper 10px of the
					// col selector (above the A/B/C labels) — separate from selection zone.
					const colGrip = colSel.createDiv({
						cls: 'bt-sel-col-drag' + (freezeCols !== undefined && ci < freezeCols ? ' bt-sel-cell-frozen' : ''),
						attr: { draggable: 'true', 'aria-label': t('dragReorderCol') },
					});
					setIcon(colGrip, 'grip-vertical');
					colGrip.setCssProps({ '--cdx': `${colX + w / 2}px` });
					colGrip.addEventListener('dragstart', (evt: DragEvent) => {
						selDragging = false;
						selAxis = null; selI1 = selI2 = -1;
						updateTableHighlights();
						evt.dataTransfer?.setData('bt-drag-col', String(ci));
						cell.addClass('bt-dragging');
					});
					colGrip.addEventListener('dragend', () => cell.removeClass('bt-dragging'));
				}
				// Hidden column groups get no selector-strip cell — the in-table
				// bt-col-indicator (§ renderRow) is the single "click to show" entry point.
				colX += w;
			}

			// Row selector — cells positioned by --rt/--rh relative to the selector's
			// own top edge, which CSS Grid aligns with the table wrapper automatically.
			rowSel.querySelectorAll('.bt-sel-cell, .bt-sel-row-drag').forEach(e => e.remove());
			const allTrs = [
				...Array.from(thead.querySelectorAll<HTMLElement>('tr')),
				...Array.from(tbody.querySelectorAll<HTMLElement>('tr')),
			];
			// Row selector — one cell per physical row, independent of rowspan merges.
			// Use getBoundingClientRect() for row positions: tr.offsetTop is relative to
			// tr.offsetParent which can be tbody (not table), causing all tbody rows to
			// report offsetTop=0. getBoundingClientRect() always gives viewport coords
			// so subtracting table's top gives the correct table-relative offset.
			const tableTop = table.getBoundingClientRect().top;
			for (const tr of allTrs) {
				if (!tr) continue;
				const trRect = tr.getBoundingClientRect();
				const rowTop = trRect.top - tableTop;
				const rowH   = trRect.height;
				if (tr.hasClass('bt-row-indicator')) {
					// Hidden row groups get no selector-strip cell — the in-table
					// row itself is the single "click to show" entry point.
				} else if (tr.dataset.agg) {
					// Summary/aggregate row — a small icon cell (not a row number, this
					// isn't part of model.rows) whose click opens a one-item "remove this
					// summary row" menu, plus a drag grip to reorder among summary rows
					// only. Uses [data-agg-idx] (not [data-idx]) so it never collides with
					// the real-row drag machinery above, which assumes a numeric row index.
					const agg = tr.dataset.agg as AggType;
					const cell = rowSel.createDiv({ cls: 'bt-sel-cell bt-sel-agg-cell' });
					cell.dataset.aggIdx = agg;
					setIcon(cell, 'sigma');
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					cell.addEventListener('click', (e: MouseEvent) => {
						e.stopPropagation();
						const m = new Menu();
						m.addItem(item => {
							item.setTitle(t('clearAggregate')).setIcon('trash');
							item.onClick(() => void onStructuralOp({ type: 'clear-aggregate', agg }));
						});
						showMenuPinned(m, e);
					});
					const grip = rowSel.createDiv({
						cls: 'bt-sel-row-drag bt-sel-agg-drag',
						attr: { draggable: 'true', 'aria-label': t('dragReorderAgg') },
					});
					setIcon(grip, 'grip-vertical');
					const midY = rowTop + rowH / 2 - 9;
					grip.setCssProps({ '--rdy': `${midY}px` });
					grip.addEventListener('dragstart', (evt: DragEvent) => {
						selDragging = false;
						selAxis = null; selI1 = selI2 = -1;
						updateTableHighlights();
						evt.dataTransfer?.setData('bt-drag-agg', agg);
						cell.addClass('bt-dragging');
					});
					grip.addEventListener('dragend', () => cell.removeClass('bt-dragging'));
				} else {
					const firstCell = tr.querySelector<HTMLElement>('[data-row]');
					if (!firstCell) continue;
					const ri = parseInt(firstCell.dataset.row ?? '-1');
					if (ri < 0) continue;
					const cell = rowSel.createDiv({ cls: 'bt-sel-cell' });
					cell.dataset.idx = String(ri);
					cell.setText(String(ri + 1));
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					// A frozen row's real cell doesn't move on vertical inner-scroll
					// (position:sticky) — its row-number label shouldn't either. Mirror
					// of the frozen-column case above: drop --rs-off, keep --rt. In
					// renderFreeze idx<=freezeRows are frozen (header=0 + first
					// freezeRows data rows); ri here is that same data-row value.
					const rowFrozen = freezeRows !== undefined && ri <= freezeRows;
					if (rowFrozen) cell.addClass('bt-sel-cell-frozen');
					if (selAxis === 'row') {
						const lo = Math.min(selI1, selI2), hi2 = Math.max(selI1, selI2);
						if (ri >= lo && ri <= hi2) cell.addClass('is-sel');
					}
					// Drag grip: sibling of the sel-cell, lives in the outer 10px of the
					// row selector (left zone), completely separate from the 22px selection
					// zone — no pointer-event conflict with range-selection.
					// Hidden while a sort is actually applied — the display order is
					// derived from the sort, so a manual reorder drag would have no
					// visible effect. (Sort is disabled — see hasRowSpanningMerge —
					// while a row-spanning merge exists, so the grip stays available then.)
					if (ri > 0 && !(model.sort && !hasRowSpanningMerge(model))) {
						const grip = rowSel.createDiv({
							cls: 'bt-sel-row-drag' + (rowFrozen ? ' bt-sel-cell-frozen' : ''),
							attr: { draggable: 'true', 'aria-label': t('dragReorderRow') },
						});
						setIcon(grip, 'grip-vertical');
						// Center the grip vertically within the row's height
						const midY = rowTop + rowH / 2 - 9;
						grip.setCssProps({ '--rdy': `${midY}px` });
						grip.addEventListener('dragstart', (evt: DragEvent) => {
							selDragging = false;
							selAxis = null; selI1 = selI2 = -1;
							updateTableHighlights();
							evt.dataTransfer?.setData('bt-drag-row', String(ri));
							cell.addClass('bt-dragging');
						});
						grip.addEventListener('dragend', () => cell.removeClass('bt-dragging'));
					}
				}
			}

			// Reposition persistent resize handles (column seam positions, row bottom edges).
			// parseFloat, not parseInt — see the matching comment on the colSel loop above.
			let cx = 0;
			for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
				cx += parseFloat(c.style.width) || 0;
				const dc = c.dataset.col;
				if (dc === undefined) continue;
				const h = colResizeHandles.get(parseInt(dc));
				if (h) h.setCssProps({ '--rx': `${cx}px` });
			}
			for (const [ri, h] of rowResizeHandles) {
				// data-row is 1-based (header=0, data rows=1,2,3…); ri is 0-based model index.
				const firstCell = table.querySelector<HTMLElement>(`[data-row="${ri + 1}"]`);
				const tr = firstCell?.closest<HTMLElement>('tr');
				if (tr) {
					const trR = tr.getBoundingClientRect();
					h.setCssProps({ '--ry': `${trR.bottom - tableTop}px` });
					h.removeClass('bt-sel-resize-hidden');
				} else {
					h.addClass('bt-sel-resize-hidden');
				}
			}
		};

		let selHideTimer: number | null = null;
		const scheduleSelHide = () => {
			if (selAxis !== null) return;
			if (selHideTimer) window.clearTimeout(selHideTimer);
			selHideTimer = window.setTimeout(() => {
				colSel.removeClass('bt-strip-visible');
				rowSel.removeClass('bt-strip-visible');
				restoreLayout();
				selHideTimer = null;
			}, 80);
		};

		// getBoundingClientRect delta is immune to the offsetParent chain: when the wrapper
		// (overflow-x:auto) is treated as offsetParent by some Chrome/Electron versions,
		// table.offsetLeft returns 0 (relative to wrapper) instead of the root-relative
		// centering offset.  The viewport-coordinate subtraction always gives the correct
		// root-relative position regardless of offsetParent.
		const positionSelectors = () => {
			const g = computeVisibleGeom();
			// Col selector: pinned to the visible top edge, spanning the visible width,
			// clipped (overflow:hidden in CSS). --cs-off shifts its column cells so they
			// track the table body as it scrolls horizontally; --cs-top uses the visible
			// top (vt) so the column letters stay pinned above the view while the table
			// scrolls vertically (like a sticky column header), instead of scrolling off.
			colSel.setCssProps({
				'--cs-left':  `${g.vl}px`,
				'--cs-top':   `${g.vt - SEL_TOTAL}px`,
				'--cs-width': `${g.vw}px`,
				'--cs-off':   `${g.colOffset}px`,
			});
			// Row selector: pinned just left of the visible left edge, spanning the
			// visible HEIGHT (not the full table), clipped, with --rs-off shifting its
			// row cells to track inner vertical scroll — the exact vertical mirror of
			// the col selector's --cs-off. Without this the row numbers scrolled off
			// with the table's top once the view had a vertical scrollbar.
			rowSel.setCssProps({
				'--rs-left':   `${g.vl - SEL_TOTAL}px`,
				'--rs-top':    `${g.vt}px`,
				'--rs-height': `${g.vh}px`,
				'--rs-off':    `${g.rowOffset}px`,
			});
		};
		repositionSelectorStrips = () => { positionSelectors(); };

		// prepareLayout / restoreLayout are called by the proximity handler BEFORE
		// show/hide so that positionEdgeStrips() and positionSelectors() both see
		// the same layout (table already shifted by --bt-sel-pad).
		prepareLayout = () => {
			// The left strips (row selector + ctrl column) sit to the LEFT of the table.
			// A centered/narrow table has ample margin room there, but a wide table that
			// fills the container is flush-left inside root — the strips would land at a
			// negative left and get clipped off-screen (reported: wide tables show no left
			// toolbar/row-selector). Measured against the WRAPPER's left (the visible
			// viewport edge, which — unlike the table's own left — stays put no matter how
			// far the table is horizontally scrolled): if the gap to root's left edge is
			// smaller than the widest left element needs (the ctrl column, reaching
			// SEL_TOTAL + AUTOFIT_OFFSET + 4 px left of the visible edge), reserve the
			// shortfall as padding-left so the table shifts right just enough to expose them.
			// Narrow tables measure a large gap → 0 padding → no visible shift.
			const wr0 = wrapper.getBoundingClientRect();
			const rr0 = root.getBoundingClientRect();
			const leftNeed = SEL_TOTAL + AUTOFIT_OFFSET + 4;
			const leftRoom = wr0.left - rr0.left;
			const leftPad = leftRoom < leftNeed ? Math.ceil(leftNeed - leftRoom) : 0;
			// No right/bottom padding reservation here (there used to be one for each,
			// --bt-sel-pad-right and --bt-add-pad, for addColBtn/addRowBtn back when
			// both protruded past root's own edges as absolute overlays) — both now
			// live inside .bt-table-wrapper as normal-flow sticky elements (addColBtn
			// via the contentRow flex wrapper, addRowBtn directly), fully contained
			// within root's own box already, so nothing needs compensating for.
			root.setCssProps({
				'--bt-sel-pad': `${SEL_TOTAL}px`,
				'--bt-sel-pad-left': `${leftPad}px`,
			});
			// Cancel whatever --bt-title-mb-pull the active theme set (bridged onto titleEl in
			// tableBlock.ts) so the title sits flush above the col-selector strip on hover
			// instead of stacking a second gap on top of the theme's own pull-closer value.
			const pull = titleEl ? parseFloat(getComputedStyle(titleEl).getPropertyValue('--bt-title-mb-pull')) || 0 : 0;
			titleEl?.setCssProps({ '--bt-title-mb-adj': `${-pull}px` });
			// --bt-sel-pad above just changed root's own rendered height (padding-
			// top) — the corner brackets' --vf-* offsets are wrapper-relative-to-
			// root and go stale the instant that happens. viewFrameResizeObs
			// (which watches for exactly this) won't catch it: ResizeObserver's
			// default box option is content-box, and a padding-only change never
			// touches the content box, only the border box getBoundingClientRect()
			// reports — reported as the brackets staying frozen at their pre-hover
			// spot until some UNRELATED resize (drag-resizing width/height) forced
			// a real content-box change and they visibly snapped over. Calling
			// this directly, synchronously, alongside the other reposition calls
			// this function already makes, closes that gap without waiting on the
			// observer at all.
			updateViewFrame();
		};
		restoreLayout = () => {
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
			// centering within whatever width IS available) — collapsing
			// --bt-sel-pad-left has no equivalent risk (it's a synchronous,
			// self-contained width change with no dependency on Obsidian's
			// own pane scroll state), and a wide/flush-left table reserving
			// that space permanently would itself be a visible, unasked-for
			// shift at rest — so only top stays permanently reserved (set
			// once up front too — see the initial-paint call below).
			root.setCssProps({ '--bt-sel-pad-left': '0px' });
			titleEl?.setCssProps({ '--bt-title-mb-adj': '0px' });
			repositionLockBtn();
			repositionAutoFitBtn();
			updateViewFrame(); // mirror of prepareLayout's own call — see its comment
		};

		showSelectors = () => {
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
			window.requestAnimationFrame(rebuild);
		};
		hideSelectors = scheduleSelHide;

		let selectorPanel: HTMLElement | null = null;
		const closeSelectorPanel = () => {
			selectorPanel?.remove();
			selectorPanel = null;
		};

		const startDrag = (axis: 'col' | 'row', idx: number, e: PointerEvent, wrap: HTMLElement) => {
			closeSelectorPanel();
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
				? (() => { const a: HTMLElement[] = []; for (let ci = lo; ci <= hi; ci++) a.push(...Array.from(table.querySelectorAll<HTMLElement>(`[data-col="${ci}"]`))); return a; })()
				: Array.from(table.querySelectorAll<HTMLElement>('[data-row]')).filter(e => { const r = parseInt(e.dataset.row ?? '-1'); return r >= lo && r <= hi; });

			const anchor = axis === 'col'
				? (table.querySelector<HTMLElement>(`th[data-col="${hi}"]`) ?? table)
				: (table.querySelector<HTMLElement>(`[data-row="${hi}"]`) ?? table);

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
					{ icon: 'arrow-up', label: t('sortAscending'), action: () => commitSort('asc') },
					{ icon: 'arrow-down', label: t('sortDescending'), action: () => commitSort('desc') },
					{ icon: 'repeat', label: (sortDir === 'asc' ? '✓ ' : '') + t('keepSortedAscending'),
						action: () => void onStructuralOp({ type: 'set-sort', sort: { colId: sortColId, dir: 'asc' } }) },
					{ icon: 'repeat', label: (sortDir === 'desc' ? '✓ ' : '') + t('keepSortedDescending'),
						action: () => void onStructuralOp({ type: 'set-sort', sort: { colId: sortColId, dir: 'desc' } }) },
					...(sortDir ? [{ icon: 'x', label: t('clearLiveSort'),
						action: () => void onStructuralOp({ type: 'set-sort', sort: null }) }] : []),
				];
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
					{ icon: 'sigma',  label: mark('sum') + t('aggSum'), action: () => toggle('sum') },
					{ icon: 'divide', label: mark('avg') + t('aggAvg'), action: () => toggle('avg') },
					{ icon: 'chevron-right', label: t('aggMore'), action: (evt: MouseEvent) => {
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
				{ icon: 'pin', label: t('freezeUpToCol'),
					action: () => {
						const count = hi + 1;
						if (!canFreezeCols(model, count)) { new Notice(t('freezeBlockedByMerge')); return; }
						void onStructuralOp({ type: 'set-freeze-cols', count });
					} },
				...(model.freezeCols !== undefined ? [{ icon: 'pin-off', label: t('unfreezeCols'),
					action: () => void onStructuralOp({ type: 'set-freeze-cols', count: null }) } as CellOpEntry] : []),
			];
			const freezeRowOps: CellOpEntry[] = [
				{ icon: 'pin', label: lo === 0 && hi === 0 ? t('freezeHeaderOnly') : t('freezeUpToRow'),
					action: () => {
						const count = lo === 0 && hi === 0 ? 0 : hi;
						if (!canFreezeRows(model, count)) { new Notice(t('freezeBlockedByMerge')); return; }
						void onStructuralOp({ type: 'set-freeze-rows', count });
					} },
				...(model.freezeRows !== undefined ? [{ icon: 'pin-off', label: t('unfreezeRows'),
					action: () => void onStructuralOp({ type: 'set-freeze-rows', count: null }) } as CellOpEntry] : []),
			];

			const cellOps: CellOpEntry[] = axis === 'col' ? [
				{ icon: 'arrow-left',  label: t('insertColBefore'),
					action: () => void onStructuralOp({ type: 'insert-col', afterColId: afterLeft }) },
				{ icon: 'arrow-right', label: t('insertColAfter'),
					action: () => void onStructuralOp({ type: 'insert-col', afterColId: afterRight }) },
				{ divider: true },
				{ icon: 'eye-off', label: hideColsLabel(lo, hi, colIndexToLetter),
					action: () => { for (let ci = lo; ci <= hi; ci++) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
				{ icon: 'trash',   label: deleteColsLabel(lo, hi, colIndexToLetter), danger: true,
					action: () => { for (let ci = hi; ci >= lo; ci--) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
				...(sortOps.length > 0 ? [{ divider: true } as CellOpEntry, ...sortOps] : []),
				...(aggOps.length > 0 ? [{ divider: true } as CellOpEntry, ...aggOps] : []),
				{ divider: true },
				...freezeColOps,
				{ divider: true },
				...copyOps,
			] : lo === 0 && hi === 0 ? [...copyOps, { divider: true }, ...freezeRowOps] : [  // no hide/delete for header row
				{ icon: 'arrow-up',   label: t('insertRowAbove'),
					action: () => void onStructuralOp({ type: 'insert-row', afterRowId: afterAbove }) },
				{ icon: 'arrow-down', label: t('insertRowBelow'),
					action: () => void onStructuralOp({ type: 'insert-row', afterRowId: afterBelow }) },
				{ divider: true },
				{ icon: 'eye-off', label: hideRowsLabel(lo, hi),
					action: () => { for (let ri = lo; ri <= hi; ri++) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
				{ icon: 'trash',   label: deleteRowsLabel(lo, hi), danger: true,
					action: () => { for (let ri = hi; ri >= lo; ri--) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
				{ divider: true },
				...freezeRowOps,
				{ divider: true },
				...copyOps,
			];

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
				onApplyStyle: (bg, color, size, bold, italic) => void onStructuralOp({ type: 'set-range-style', target, bg, color, size, bold, italic }),
				onClose: () => {
					selectorPanel = null;
					selAxis = null; selI1 = selI2 = -1;
					rebuild(); // clears table highlights and strip is-sel
				},
			});
		};

		colSel.addEventListener('pointerdown', (e: PointerEvent) => {
			const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
			const idx = parseInt(cell?.dataset.idx ?? '-1');
			if (idx >= 0) startDrag('col', idx, e, colSel);
		});
		colSel.addEventListener('pointermove', (e: PointerEvent) => moveDrag('col', e));
		colSel.addEventListener('pointerup', () => endDrag('col'));

		rowSel.addEventListener('pointerdown', (e: PointerEvent) => {
			const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
			const idx = parseInt(cell?.dataset.idx ?? '-1');
			if (idx >= 0) startDrag('row', idx, e, rowSel);
		});
		rowSel.addEventListener('pointermove', (e: PointerEvent) => moveDrag('row', e));
		rowSel.addEventListener('pointerup', () => endDrag('row'));

		// ── Drag-reorder via selector strips ─────────────────────────────────────
		// The grips live in the selector strips. Without dragover handlers on the
		// strips, the browser shows the "no" cursor while dragging over them (no
		// target accepts the drop). These handlers make the strips full drop zones
		// and mirror the table-row/col drop indicator so the UX is consistent.
		colSel.addEventListener('dragover', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes('bt-drag-col')) return;
			evt.preventDefault();
			const cells = Array.from(colSel.querySelectorAll<HTMLElement>('[data-idx]'));
			let toIdx = -1, minD = Infinity;
			for (const c of cells) {
				const r = c.getBoundingClientRect();
				const d = Math.abs(evt.clientX - (r.left + r.width / 2));
				if (d < minD) { minD = d; toIdx = parseInt(c.dataset.idx ?? '-1'); }
			}
			if (toIdx >= 0 && toIdx !== dragOverCol) {
				clearDropIndicators();
				dragOverCol = toIdx;
				table.querySelectorAll<HTMLElement>(`[data-col="${toIdx}"]`).forEach(e => e.addClass('bt-col-drop-before'));
			}
		});
		colSel.addEventListener('drop', (evt: DragEvent) => {
			evt.preventDefault();
			clearDropIndicators();
			const fromIdx = parseInt(evt.dataTransfer?.getData('bt-drag-col') ?? '-1');
			const cells = Array.from(colSel.querySelectorAll<HTMLElement>('[data-idx]'));
			let toIdx = -1, minD = Infinity;
			for (const c of cells) {
				const r = c.getBoundingClientRect();
				const d = Math.abs(evt.clientX - (r.left + r.width / 2));
				if (d < minD) { minD = d; toIdx = parseInt(c.dataset.idx ?? '-1'); }
			}
			if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx)
				void onStructuralOp({ type: 'move-col', fromColId: colId(model, fromIdx), toColId: colId(model, toIdx) });
			dragOverCol = -1;
		});

		rowSel.addEventListener('dragover', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes('bt-drag-row')) return;
			evt.preventDefault();
			const cells = Array.from(rowSel.querySelectorAll<HTMLElement>('[data-idx]'));
			let toIdx = -1, minD = Infinity;
			for (const c of cells) {
				const r = c.getBoundingClientRect();
				const d = Math.abs(evt.clientY - (r.top + r.height / 2));
				if (d < minD) { minD = d; toIdx = parseInt(c.dataset.idx ?? '-1'); }
			}
			if (toIdx >= 1 && toIdx !== dragOverRow) {
				clearDropIndicators();
				dragOverRow = toIdx;
				tbody.querySelector<HTMLElement>(`tr:has([data-row="${toIdx}"])`)?.addClass('bt-drop-before');
			}
		});
		rowSel.addEventListener('drop', (evt: DragEvent) => {
			evt.preventDefault();
			clearDropIndicators();
			const fromIdx = parseInt(evt.dataTransfer?.getData('bt-drag-row') ?? '-1');
			const cells = Array.from(rowSel.querySelectorAll<HTMLElement>('[data-idx]'));
			let toIdx = -1, minD = Infinity;
			for (const c of cells) {
				const r = c.getBoundingClientRect();
				const d = Math.abs(evt.clientY - (r.top + r.height / 2));
				if (d < minD) { minD = d; toIdx = parseInt(c.dataset.idx ?? '-1'); }
			}
			if (fromIdx >= 1 && toIdx >= 1 && fromIdx !== toIdx)
				void onStructuralOp({ type: 'move-row', fromRowId: rowId(model, fromIdx), toRowId: rowId(model, toIdx) });
			dragOverRow = -1;
		});

		// Reorder summary/aggregate rows among themselves — separate [data-agg-idx]
		// pool (not [data-idx]) so this never interferes with real-row drag targeting.
		rowSel.addEventListener('dragover', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes('bt-drag-agg')) return;
			evt.preventDefault();
			const cells = Array.from(rowSel.querySelectorAll<HTMLElement>('[data-agg-idx]'));
			let toAgg: AggType | null = null, minD = Infinity;
			for (const c of cells) {
				const r = c.getBoundingClientRect();
				const d = Math.abs(evt.clientY - (r.top + r.height / 2));
				if (d < minD) { minD = d; toAgg = (c.dataset.aggIdx as AggType | undefined) ?? null; }
			}
			if (toAgg && toAgg !== dragOverAgg) {
				clearDropIndicators();
				dragOverAgg = toAgg;
				tbody.querySelector<HTMLElement>(`tr[data-agg="${toAgg}"]`)?.addClass('bt-drop-before');
			}
		});
		rowSel.addEventListener('drop', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes('bt-drag-agg')) return;
			evt.preventDefault();
			clearDropIndicators();
			const fromAgg = (evt.dataTransfer?.getData('bt-drag-agg') || null) as AggType | null;
			const cells = Array.from(rowSel.querySelectorAll<HTMLElement>('[data-agg-idx]'));
			let toAgg: AggType | null = null, minD = Infinity;
			for (const c of cells) {
				const r = c.getBoundingClientRect();
				const d = Math.abs(evt.clientY - (r.top + r.height / 2));
				if (d < minD) { minD = d; toAgg = (c.dataset.aggIdx as AggType | undefined) ?? null; }
			}
			if (fromAgg && toAgg && fromAgg !== toAgg) {
				const order = activeAggTypes(model).filter(a => a !== fromAgg);
				order.splice(order.indexOf(toAgg), 0, fromAgg);
				void onStructuralOp({ type: 'reorder-aggregate', order });
			}
			dragOverAgg = null;
		});

		// Column/row resize changes cell geometry → reposition + rebuild selector strips
		table.addEventListener('bt-layout-changed', () => {
			if (colSel.hasClass('bt-strip-visible') || rowSel.hasClass('bt-strip-visible')) {
				positionSelectors();
				rebuild();
			}
		});

		// Also reposition when the table's rendered box changes for a reason that
		// never fires bt-layout-changed — page zoom (Ctrl+/Ctrl-) chief among them,
		// same gap already fixed for positionEdgeStrips/positionCtrlCol above.
		// Without this, the strips stayed at their pre-zoom screen position until
		// some unrelated click happened to trigger a full rebuild — reported as the
		// row selector visibly sinking into the table at higher zoom levels.
		//
		// positionSelectors() is called directly, not deferred via
		// requestAnimationFrame: ResizeObserver notifications already run after
		// layout but before that frame's paint, so calling synchronously lands
		// the corrected position in the SAME frame the table itself resized —
		// deferring it was reported as a visible two-step "table resizes, then
		// the selector visibly catches up a beat later" during continuous
		// zooming (same fix applied to positionEdgeStrips' own observer above,
		// for the same symptom on the +add strips). Safe to call synchronously
		// (no ResizeObserver-loop risk): it only sets CSS custom properties on
		// colSel/rowSel, which aren't observed and don't feed back into table's
		// own size — same reasoning as positionCtrlCol's observer, which has
		// always called its handler directly.
		//
		// rebuild(), unlike positionSelectors(), IS deferred via
		// requestAnimationFrame — it re-measures and re-pins auto-layout column
		// widths onto <col> elements that are themselves children of the
		// observed table (see rebuild()'s !hasExplicitWidths branch), and
		// writing a layout-affecting style from inside this same ResizeObserver
		// callback risks a "loop completed with undelivered notifications"
		// warning if that write itself changes table's box. Without calling
		// rebuild() here at all, a table with no explicit column widths (its
		// rendered widths depend on the available container width, unlike a
		// fixed-px table) went stale on any resize that isn't an explicit
		// column-drag — reported as the selector's per-column boundaries
		// visibly drifting out of alignment with the table's own columns.
		// Guard against a self-induced ResizeObserver loop: rebuild() re-pins
		// <col> widths, which resizes the table and re-fires THIS observer. When
		// both row+col freeze add sticky positioning, the re-measured widths can
		// come back a hair different each pass and never settle, so rebuild()
		// keeps running every frame and pins the main thread — reported as
		// Obsidian hanging when adding row-freeze to an already-column-frozen
		// table. Skipping the rebuild when the table's size matches what the LAST
		// rebuild produced breaks that loop (a genuine resize — zoom, container
		// change — still differs and re-runs). positionSelectors() stays
		// unconditional: it only reads rects and writes to the non-observed
		// selector strips, so it can't feed back.
		let lastRebuiltW = -1, lastRebuiltH = -1, selRebuildScheduled = false;
		const selResizeObs = new ResizeObserver(() => {
			if (!colSel.hasClass('bt-strip-visible') && !rowSel.hasClass('bt-strip-visible')) return;
			positionSelectors();
			const r = table.getBoundingClientRect();
			if (Math.abs(r.width - lastRebuiltW) < 0.5 && Math.abs(r.height - lastRebuiltH) < 0.5) return;
			if (selRebuildScheduled) return;
			selRebuildScheduled = true;
			window.requestAnimationFrame(() => {
				selRebuildScheduled = false;
				rebuild();
				const r2 = table.getBoundingClientRect();
				lastRebuiltW = r2.width;
				lastRebuiltH = r2.height;
			});
		});
		selResizeObs.observe(table);
		component?.register(() => selResizeObs.disconnect());

		// Horizontal scroll: only the containers + the --cs-off shift need updating —
		// the per-column cells stay table-relative and follow --cs-off via CSS, so no
		// full rebuild() is needed (keeps scrolling smooth). rAF-coalesced.
		let selScrollScheduled = false;
		wrapper.addEventListener('scroll', () => {
			if (!colSel.hasClass('bt-strip-visible') && !rowSel.hasClass('bt-strip-visible')) return;
			if (selScrollScheduled) return;
			selScrollScheduled = true;
			window.requestAnimationFrame(() => {
				selScrollScheduled = false;
				positionSelectors();
				repositionCtrlCol();
			});
		});
	}

	// ── Show/hide overlays on mouse enter/leave ───────────────────────────────
	// With CSS Grid, root already includes all strip areas — hovering them fires
	// enter/leave naturally. No viewport math or rAF throttling needed.
	if (onStructuralOp) {
		root.addEventListener('mouseenter', () => {
			// prepareLayout MUST run before any position calculation so all
			// getBoundingClientRect() calls see the final padded layout.
			prepareLayout();
			repositionLockBtn();
			repositionAutoFitBtn();
			repositionCtrlCol();
			showEdgeStrips();
			showSelectors();
		});
		// A menu/panel we opened (Menu, cell/filter panel) always renders outside
		// root's own DOM subtree (appended to document.body), so moving the mouse
		// onto it fires a real mouseleave here. While one is open, defer hiding
		// until it actually closes (onHoverUnpinned below) instead of collapsing
		// the strips out from under the user's cursor and re-showing them the
		// moment the mouse comes back — that jump was the reported bad UX.
		root.addEventListener('mouseleave', () => {
			if (isHoverPinned()) return;
			hideEdgeStrips(); hideSelectors();
		});
		component?.register(onHoverUnpinned(() => {
			if (!root.matches(':hover')) { hideEdgeStrips(); hideSelectors(); }
		}));
		// Reserve the top strip padding from the very first paint, not just
		// from the first hover onward, and never collapse it back (see
		// restoreLayout's own comment) — every table, not only one with a
		// sheet-tab-bar below it (that was the original, narrower trigger for
		// this same permanent-reservation treatment; the outer-pane-scrollbar
		// shift is a second, more general one). Sets --bt-sel-pad directly
		// rather than calling the full prepareLayout() — that also computes
		// --bt-sel-pad-left, which stays intentionally hover-only (see
		// restoreLayout's comment on why that one doesn't need the same fix).
		root.setCssProps({ '--bt-sel-pad': `${SEL_TOTAL}px` });
		updateViewFrame();
	}

	// ── Cursor-position CSS variables (base layer, usable by any theme) ────────
	// Themes can read --bt-mx/--bt-my to create cursor-reactive visual effects
	// (e.g. cursor glow, gradient follow). Rect is cached on enter to avoid
	// forced-layout on every mousemove.
	{
		let rootRect: DOMRect | null = null;
		root.addEventListener('mouseenter', () => { rootRect = root.getBoundingClientRect(); });
		root.addEventListener('mousemove', (e: MouseEvent) => {
			// Skip while a write-back is pending on this (about-to-be-replaced) root —
			// same reasoning as .bt-write-pending's animation pause: every write here
			// repaints a theme's cursor-glow gradient for no visual benefit, and competes
			// with the main thread for the time it needs to resolve the vault write.
			if (root.hasClass('bt-write-pending')) return;
			if (!rootRect) rootRect = root.getBoundingClientRect();
			root.setCssProps({
				'--bt-mx': `${Math.round(e.clientX - rootRect.left)}px`,
				'--bt-my': `${Math.round(e.clientY - rootRect.top )}px`,
			});
		});
		root.addEventListener('mouseleave', () => {
			rootRect = null;
			root.setCssProps({ '--bt-mx': '-9999px', '--bt-my': '-9999px' });
		});
		component?.register(() => { rootRect = null; });
	}
}


