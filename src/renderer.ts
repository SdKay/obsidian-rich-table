import { clampToValidCell, moveCell, type NavCell } from './cellNav';
import type { ChoiceRegistry } from './choiceRegistry';
import { FillSequenceModal } from './fillSequenceModal';
import { collapsedRowsLabel, deleteColsLabel, deleteRowsLabel, hideColsLabel, hideRowsLabel, t } from './i18n';
import { createLayoutSync } from './layoutSync';
import type { ColumnDefV2, CtrlColButtonId, TableModelV2 } from './model';
import { renderAggregateRows } from './renderAggregate';
import { renderCalendarBoard } from './renderCalendar';
import { renderRow } from './renderCell';
import { renderCellDragSelect } from './renderCellDragSelect';
import { cellEffectiveStyle } from './renderCellStyle';
import { copyRangeAsMarkdown, copyRangeToClipboard } from './renderClipboard';
import { renderCtrlCol } from './renderCtrlCol';
import { renderEdgeStrips } from './renderEdgeStrips';
import { enterLineEdit } from './renderEditMode';
import { createFormulaPick } from './renderFormulaPick';
import { renderFrozenCells } from './renderFreezeDom';
import { computeVisibleGeom as computeVisibleGeomPure, type VisibleGeom } from './renderGeometry';
import { buildOccupied, colId, computeHeaderRowSpan, countVisibleCells, expandToMerges, getMergeOrigin, isRowFiltered, mergeOriginIndex, resolveMergeBounds, rowId } from './renderGridHelpers';
import { renderHover } from './renderHover';
import { renderKanbanBoard } from './renderKanban';
import { renderKeyboard } from './renderKeyboard';
import { renderOverlays } from './renderOverlays';
import { ownCells } from './renderOwnScope';
import { buildAlignCellOp, openCellPanel, SELECTION_PANEL_OPS, withEdits, type CellOpEntry } from './renderPanel';
import { takeSelectedCell } from './renderSelectionHandoff';
import { renderSelectorStrips, SELECTOR_STRIP_OPS } from './renderSelectorStrips';
import type { StripAxis } from './stripRebuildPlan';
import { applySortForDisplay } from './renderSort';
import { renderStatusBar } from './renderStatusBarDom';
import { compileStyles } from './styleIndex';
import type { CellChangeHandler, EditNavigateHandler, TableAction } from './renderTypes';
import { columnTypeKinds, type ColumnKinds } from './columnKind';
import { NO_EDITS, type TableEdits } from './tableEdits';
import { renderRowJump, type RowJump } from './renderRowJump';
import { renderVScroll } from './renderVScroll';
import { renderViewToolbar } from './renderViews';
import { applyZoom, zoomFactor } from './renderZoom';
import { AUTOFIT_OFFSET, SEL_CELL, SEL_UNIT, VIEW_EDGE_GAP } from './selectorLayout';
import { fillRuns } from './sequenceFill';
import { shellStyled, whenStylesReady } from './stylesReady';
import { colIndexToLetter } from './utils';
import { App, Component } from 'obsidian';

export interface RenderTableOptions {
	/** What the table can change and the one way to change it; nothing, when absent. */
	edits?: TableEdits;
	/** Toolbar buttons the kind of table offers that do not change it (open its file, snapshot, export). */
	actions?: readonly TableAction[];
	/** What the header menu offers to make a column, when the kind of table decides it; a column type otherwise. */
	columnKinds?: (col: ColumnDefV2) => ColumnKinds;
	/** Present for a table whose rows come from somewhere: which cells lead there and how to go. */
	rowJump?: RowJump;
	onRootReady?: (root: HTMLElement) => void;
	isSwapping?: () => boolean;
	/** Table identity for renderEditHandoff.ts's cross-rebuild edit resume —
	 *  same key tableBlock.ts's renderCache uses. */
	cacheKey?: string;
	/** Read fresh on each click (not captured once) so toggling the setting takes
	 *  effect on already-rendered tables without a re-render. When it returns true,
	 *  single click enters edit immediately and Ctrl/Cmd+click opens the style panel
	 *  (vs the default single-click-delay / double-click-panel). */
	getSingleClickEdit?: () => boolean;
	/** Toolbar buttons the user hid in the settings. Hiding a button only hides it: what the table can do is
	 *  unchanged. */
	hiddenCtrlColButtons?: ReadonlySet<CtrlColButtonId>;
	/** True when this table is one sheet of a 2+-sheet workbook — the sheet
	 *  tabs (mounted into .bt-status-tabs, see tableBlock.ts) are the only way
	 *  to switch sheets at all, so `model.statusBarMode === 'hover'` is
	 *  overridden to always show the bar here regardless of that per-sheet
	 *  preference: hiding the bar in that case wouldn't just hide stats, it
	 *  would hide the workbook's own sheet navigation. A single-sheet table's
	 *  own hover preference (if any) is untouched — this only forces pinned
	 *  ON, never forces it off. */
	forceStatusBarPinned?: boolean;
}

export async function renderTable(
	model: TableModelV2,
	getRegistry: () => ChoiceRegistry,
	container: HTMLElement,
	app: App,
	sourcePath: string,
	component: Component,
	options: RenderTableOptions = {},
): Promise<void> {
	const { edits = NO_EDITS, actions = [], columnKinds = (col: ColumnDefV2) => columnTypeKinds(col, getRegistry()), rowJump, onRootReady, isSwapping, cacheKey, getSingleClickEdit, hiddenCtrlColButtons, forceStatusBarPinned } = options;
	if (model.columns.length === 0) return;
	// Sort is a display-only transform: reorder a LOCAL copy of `rows` (never the
	// object the caller holds for write-back) so every existing display-index-based
	// lookup below (rowId(), isRowFiltered(), cellRawValue(), etc.) keeps working
	// unmodified — display index and storage index are the same again after this.
	model = applySortForDisplay(model, getRegistry());
	const run = edits.run;

	// Row/col-index-based adapters for the cell editors.
	// rowIdx=0 → header (set-col-name); rowIdx≥1 → data cell (set-cell-content).
	const onCellChange: CellChangeHandler = (ri, ci, value) => {
		if (ri === 0) {
			run({ type: 'set-col-name', colId: colId(model, ci), name: value });
		} else {
			// Editing a merge's effective anchor (possibly promoted past a hidden literal
			// anchor, see getMergeOrigin) must write to the merge's literal anchor cell —
			// this row may just be standing in for a hidden anchor and has no data of its own.
			const merge = getMergeOrigin(ri, ci, model);
			const targetRowId = merge?.anchorRowId ?? rowId(model, ri);
			const targetColId = merge?.anchorColId ?? colId(model, ci);
			run({ type: 'set-cell-content', rowId: targetRowId, colId: targetColId, value });
		}
	};

	// Snapshot for rendering; getRegistry used in event handlers for fresh lookups
	const registry = getRegistry();

	// Shared show/hide hooks for the two hover overlays (edge-add strips + selector
	// strips). Assigned inside their blocks, much further down this function; driven
	// by one proximity handler below. Declared here — before any listener/observer
	// is registered and before the first `await renderRow(...)` — rather than right
	// next to where they're assigned: a `let` binding is in TDZ until its own
	// declaration line actually runs, and this function awaits per-cell markdown
	// rendering for every row, which gives the browser real opportunities to fire a
	// ResizeObserver callback (registered further below, well before the awaits) or
	// a drag's pointermove handler mid-await — both call several of these before the
	// "real" implementations would otherwise have been assigned yet, throwing
	// "Cannot access '...' before initialization" (reproduced: `viewFrameResizeObs`'s
	// rAF callback firing while renderTable() was still awaiting an earlier row's
	// cell render). Declaring the stubs this early guarantees they're always a real,
	// callable no-op the instant anything could possibly reach for them.
	//
	// prepareLayout / restoreLayout are called by the proximity handler BEFORE any
	// show/hide call so that ALL position calculations see the same, correct layout.
	// This prevents cascading errors when padding-top changes on root (which shifts
	// the table and would invalidate any positions computed before the change).
	// Hooks each feature section below fills in for the others to call. One object, so that a section
	// reaches another only through a name declared here.
	const hooks = {
		showEdgeStrips: () => { /* assigned in edge block */ },
		hideEdgeStrips: () => { /* assigned in edge block */ },
		isEdgeStripsVisible: () => false,
		showSelectors: () => { /* assigned in selector block */ },
		hideSelectors: () => { /* assigned in selector block */ },
		prepareLayout: () => { /* assigned in selector block */ },
		restoreLayout: () => { /* assigned in selector block */ },
		liftTitle: () => { /* assigned in selector block */ },
		repositionCtrlCol: (_geom?: VisibleGeom) => { /* assigned in ctrl-column block */ },
		repositionSelectorStrips: (_geom?: VisibleGeom) => { /* assigned in selector block */ },
		repositionEdgeStrips: (_geom?: VisibleGeom) => { /* assigned in edge block */ },
		updateStatusBarStats: () => { /* assigned in status-bar block */ },
		updateOuterFrame: () => { /* assigned once statusBar exists */ },
		reapplyFreezeNow: () => { /* assigned in frozen-rows/columns block */ },
		stripCellBusy: () => false,
		markStripsStale: (_axis?: StripAxis) => { /* assigned in the selector block */ },
	};
	// Read by bindScrollSync's shared isActive() check (selector block, below) —
	// addRowBtn/addColBtn themselves are block-scoped to the edge-strip block and
	// unreachable from there otherwise.
	// Optional `geom` — bindScrollSync (below) computes the shared frame's
	// geometry once and passes it to all three of these, instead of each
	// independently recomputing identical geometry (see that module's own
	// doc comment). Every OTHER call site (resize observers, mouseenter,
	// drag-resize) omits it and gets a fresh computeVisibleGeom() as before.
	// Cheap, rebuild-free repositioning (no visibility toggle, no per-cell
	// rebuild) — hoisted so the width/height drag-resize handles below can keep
	// the strips tracking the view's live size during a drag, the same way the
	// wrapper's own scroll listener already does for scroll (see those call
	// sites for precedent: they call positionSelectors()/positionEdgeStrips()
	// directly, never showSelectors()/rebuild(), specifically to stay cheap
	// enough to run on every event in a fast-firing loop).
	// Assigned once the status bar exists (below) — the outer frame's bottom
	// edge must extend to include a hover-mode status bar while it's showing,
	// which only that block knows how to check (see the frame element's own
	// creation comment for why this can't just read `shell`'s own rect).
	// Assigned in the frozen-rows/columns block, once thead/tbody exist — lets
	// the drag-resize handle (defined earlier) keep frozen offsets exactly in
	// step with the geometry it just wrote live, instead of waiting on
	// freezeResizeObs's own rAF-coalesced re-measure (a real one-frame lag,
	// visible as the frozen column stuttering during a slow drag).

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
	function renderFooter(parent: HTMLElement = container): HTMLElement | null {
		if (!model.footer || model.collapsed) return null;
		// Flatten array and split strings on \n so YAML arrays and \n-strings both work
		const rawLines = Array.isArray(model.footer) ? model.footer : [model.footer];
		const lines = rawLines.flatMap(l => l.split('\n'));
		const footerEl = parent.createDiv({ cls: 'bt-table-footer' });
		for (const line of lines) {
			footerEl.createDiv({ cls: 'bt-table-footer-line', text: line });
		}
		if (edits.can('set-footer')) {
			footerEl.addClass('bt-text-editable');
			footerEl.setAttribute('aria-label', t('clickToEditFooter'));
			footerEl.setAttribute('data-tooltip-position', 'top');
			footerEl.addEventListener('click', () => {
				if (footerEl.hasClass('bt-editing')) return;
				const currentText = lines.join('\n');
				enterLineEdit(footerEl, currentText, newVal => {
					if (!newVal) {
						run({ type: 'set-footer', footer: undefined });
						return;
					}
					const parts = newVal.split('\n').filter(l => l.length > 0);
					run({
						type: 'set-footer',
						footer: parts.length === 1 ? (parts[0] ?? newVal) : parts,
					});
				}, true /* multiLine */);
			});
		}
		return footerEl;
	}

	const occupied = buildOccupied(model);
	// Every cell asks which merge it anchors and which style rules apply to it; resolving them again for each one
	// took seconds on a large table.
	const merges = mergeOriginIndex(model);
	const styleOf = compileStyles(model);
	// The keyboard-Selected cell, carried over from the instance a write-back just
	// replaced (renderSelectionHandoff.ts). Re-validated against the CURRENT model
	// because the very operation that triggered this rebuild may have deleted the
	// row or column it was sitting on. Applied after the rows exist — see the
	// restore just below the data-row loop.
	let restoredSel: NavCell | null = null;
	if (cacheKey) {
		const remembered = takeSelectedCell(cacheKey);
		if (remembered) restoredSel = clampToValidCell(model, occupied, remembered);
	}
	// Outer shell, NEVER zoomed — hosts `root` (the actual zoomed subtree:
	// table, toolbar, title) and the status bar as two plain siblings. Exists
	// solely so the status bar's own zoom control (mounted inside it, below)
	// isn't itself a descendant of the element it's dragging the zoom of: a
	// native <input type=range> maps mouse position to value against its OWN
	// on-screen track geometry, and that geometry is exactly what changes,
	// mid-drag, the instant `root`'s zoom changes — confirmed via direct
	// probe: an ancestor whose zoom an input's own 'input' handler changes
	// runs away almost immediately (a 20px real mouse move produced a value
	// jump equivalent to 100%→212%) purely from the track rescaling under the
	// cursor, with no bug in the value math itself. Keeping the control
	// outside the zoomed subtree removes the feedback loop entirely, which is
	// also the more intuitive behaviour (Excel's own status bar never scales
	// itself along with the sheet).
	const shell = container.createDiv({ cls: 'bt-render-root-shell' });
	// Hidden until the plugin's stylesheet shows it: Obsidian reads styles.css only after onload, and a note
	// already open has its tables drawn in between. Set inline, so it holds while there is no stylesheet; a
	// CSS variable would need that stylesheet to mean anything.
	shell.setCssProps({ visibility: 'hidden' });
	// Lets the parts of the table transition from the frame after the stylesheet showed it; see styles.css.
	// Asked from the next frame: the shell is built off-screen and attached after this function returns.
	window.requestAnimationFrame(() => whenStylesReady(
		() => window.requestAnimationFrame(() => shell.addClass('bt-settled')),
		{ isReady: () => shellStyled(shell), nextFrame: fn => { window.requestAnimationFrame(fn); } },
	));
	// Root container with position:relative so all overlay elements (selectors,
	// edge-add strips) can use position:absolute and stay naturally inside
	// Obsidian's content pane — no viewport coordinate math needed.
	const themeClass = model.theme ? `bt-render-root bt-theme-${model.theme}` : 'bt-render-root';
	const root = shell.createDiv({ cls: themeClass + (model.collapsed ? ' bt-collapsed' : '') });
	onRootReady?.(root);
	applyZoom(root, model.zoom);

	// The table's own outer frame — a single border wrapping everything that
	// visually belongs to "this table" (grid, left toolbar, row/col selector
	// strips, the whole-view resize handles, and a PINNED status bar), the
	// user's own framing being obsidian-rich-view's fully-enclosed look as the
	// bar to match. A `shell` child, not `root`'s, so it can extend down around
	// a status bar that sits below root in normal flow.
	shell.createDiv({ cls: 'bt-outer-frame' });

	// Title — a child of `root`, not `container`, so it scales together with
	// the table under zoom (the user's own framing: "标题也跟着一起缩放"). Was a
	// sibling of root when zoom didn't exist yet; moving it inside is safe —
	// nothing in this file, tableBlock.ts, or tableSnapshot.ts keys off titleEl
	// being outside root: the snapshot/PNG-export path (tableSnapshot.ts)
	// already clones `root` itself — an inside title is simply included in
	// that clone for free, which is the right outcome (the title names the
	// table; it belongs in a picture of it) rather than something to guard
	// against.
	//
	// TOP_STRIP_PAD's reservation (below) DOES still care about DOM position,
	// though — it used to land as root's own padding-top, which sat directly
	// above root's ONLY content (the table) back when title was root's
	// sibling. With title now root's first child, that same padding pushes
	// the title down instead of opening a gap where the column-selector strip
	// actually anchors (just above the table) — reported as the strip
	// covering the title outright on hover. So: with a title present, the
	// reservation moves onto the TITLE's own margin-bottom via
	// --bt-title-sel-pad (stacking with --bt-title-mb-pull/-adj the same way
	// those two already stack with each other), leaving root's padding-top at
	// 0; TOP_STRIP_PAD itself already special-cases model.title to 0 for
	// exactly the same reason (see its own comment) — this just moves WHERE
	// that reserved space lands instead of dropping it outright.
	if (model.title) {
		const titleEl = root.createDiv({ cls: 'bt-table-title' });
		titleEl.createSpan({ text: model.title });
		titleEl.setCssProps({ '--bt-title-sel-pad': `${SEL_UNIT}px` });
		if (edits.can('set-title')) {
			titleEl.addClass('bt-text-editable');
			titleEl.setAttribute('aria-label', t('clickToEditTitle'));
			titleEl.setAttribute('data-tooltip-position', 'top');
			titleEl.addEventListener('click', () => {
				if (titleEl.hasClass('bt-editing')) return;
				enterLineEdit(titleEl, model.title ?? '', newVal => {
					run({ type: 'set-title', title: newVal || undefined });
				});
			});
		}
	}

	// The factor every zoom-aware geometry correction below divides by (see renderGeometry.ts's NO_ZOOM for
	// why it is a number and not measured back off the DOM). The zoom slider changes it live, without a
	// re-render, so a section reads `view.zoom` when it runs and never keeps a copy.
	const view = { zoom: zoomFactor(model.zoom) };

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
		const viewMain = renderViewToolbar({ root, model, registry, edits, activeView });
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
			renderKanbanBoard({ model, wrapper: viewWrapper, view: activeView, registry, edits });
		} else {
			renderCalendarBoard({ model, wrapper: viewWrapper, root, view: activeView, registry, edits, cacheKey: cacheKey ?? '' });
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

	// The first real updateOuterFrame() call is scheduled further down, once
	// `updateOuterFrame` has been reassigned past its early TDZ-safe stub (see
	// that `let`'s own doc comment) — calling it via rAF here would instead
	// capture and later invoke THIS stub reference, a real bug this exact
	// spot hit when updateViewFrame (a real function defined right here, not
	// a forward-declared stub) still lived in this block and could safely be
	// scheduled immediately.
	//
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
	// alongside updateOuterFrame(), closes that gap.
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

	// Drag-resize handles (edit mode only) — dragging the view's OUTER edge
	// (bottom = height, right = width, corner = both), like resizing the whole
	// code-block, not an inner frame around just the table. The handles live on
	// `root` itself (the outermost element we own, which hugs the block) and are
	// pinned to its edges via CSS; a drag live-applies the size to the wrapper
	// (the scroll container) and persists it on release.
	// The handles that would write a size the table cannot take are not drawn.
	const resizableW = edits.can('set-view-width'), resizableH = edits.can('set-view-height');
	if (resizableW || resizableH) {
		const makeHandle = (cls: string, mode: 'h' | 'w' | 'both', container: HTMLElement) => {
			const handle = container.createDiv({ cls: `bt-view-resize ${cls}` });
			handle.addEventListener('pointerdown', (e: PointerEvent) => {
				e.preventDefault();
				e.stopPropagation();
				handle.setPointerCapture(e.pointerId);
				const startX = e.clientX, startY = e.clientY;
				// r is VISUAL (getBoundingClientRect) but --bt-view-width/-height are
				// consumed as LOGICAL px (the property they size, unaffected by zoom)
				// — divide both r and every clientX/clientY delta below by zoom before
				// using them, same correction shape as scrollContentOffset's own (see
				// renderGeometry.ts's NO_ZOOM doc comment).
				const r = wrapper.getBoundingClientRect();
				let newW = r.width / view.zoom, newH = r.height / view.zoom;
				const onMove = (ev: PointerEvent) => {
					if (mode !== 'h') {
						// ×2 on the mouse delta, not ×1 — wrapper stays centered via
						// margin-inline:auto (width drag is the one axis that IS
						// centered; height uses margin-block:0, hence no equivalent
						// factor there), so growing/shrinking its WIDTH by ∆ only
						// moves its right edge — where this handle visually sits —
						// by ∆/2, the other ∆/2 going to the left edge instead.
						// Reported ("宽度移动比鼠标移动慢，不是一比一，高度调整不
						// 存在以上...问题"): doubling the delta here makes the
						// width itself grow at 2x the mouse's movement, so the
						// visible right edge — which only gets HALF of that — ends
						// up moving at exactly 1x, matching the cursor.
						newW = Math.max(80, r.width / view.zoom + 2 * (ev.clientX - startX) / view.zoom);
						wrapper.addClass('bt-view-fixed-w');
						wrapper.setCssProps({ '--bt-view-width': `${Math.round(newW)}px` });
					}
					if (mode !== 'w') {
						newH = Math.max(60, r.height / view.zoom + (ev.clientY - startY) / view.zoom);
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
					hooks.prepareLayout();
					hooks.repositionSelectorStrips();
					hooks.repositionCtrlCol();
					// prepareLayout has just moved the frame (updateOuterFrame), in this event rather than a frame later
					// through the observers, which are coalesced to the next frame and read as a lag behind the handle.
					// The frozen cells are re-placed the same way (reported: the frozen column shaking).
					hooks.reapplyFreezeNow();
				};
				const onUp = () => {
					handle.removeEventListener('pointermove', onMove);
					handle.removeEventListener('pointerup', onUp);
					if (mode !== 'h') run({ type: 'set-view-width', width: Math.round(newW) });
					if (mode !== 'w') run({ type: 'set-view-height', height: Math.round(newH) });
				};
				handle.addEventListener('pointermove', onMove);
				handle.addEventListener('pointerup', onUp);
			});
		};
		if (resizableH) makeHandle('bt-view-resize-b', 'h', shell);
		if (resizableW) makeHandle('bt-view-resize-r', 'w', shell);
		if (resizableW && resizableH) makeHandle('bt-view-resize-br', 'both', shell);
	}

	// contentRow holds <table> and (in edit mode) addColBtn side by side via flex,
	// so addColBtn's height can be a plain `align-self: stretch` matching table's
	// own rendered height instead of a JS measurement — see addColBtn's creation
	// below for the full reasoning (mirrors why addRowBtn is a wrapper-level
	// sticky sibling rather than a root-level absolute overlay).
	const contentRow = wrapper.createDiv({ cls: 'bt-table-content-row' });
	const table = contentRow.createEl('table', { cls: 'bt-table' });
	// Picking cells for a formula being edited (renderFormulaPick.ts). Shared: the cell editor turns it on and off,
	// the pointer handlers drive the drag.
	const formulaPick = createFormulaPick(model, table);

	// Visible-viewport geometry, all in root-relative px — see renderGeometry.ts's
	// own doc comment for the field-by-field meaning. Pulled out to a pure,
	// parameterized function there (shared with bindScrollSync, below) since
	// every caller here wants this closure's own table/root/wrapper anyway;
	// this local alias keeps every existing zero-arg call site unchanged. The
	// closure's own `zoom` factor flows through here too, for the same reason —
	// every one of THOSE call sites gets the correction for free without
	// individually knowing zoom exists.
	const computeVisibleGeom = () => computeVisibleGeomPure(table, root, wrapper, view.zoom);

	// Everything that follows the table's layout is registered here and runs in one fixed order; see
	// layoutSync.ts. A strip cell being dragged or held makes the rebuild of the cells wait.
	const watchedBoxes: HTMLElement[] = [];
	const layoutSync = createLayoutSync({
		// A watched track counts by its size only: the round itself moves it (with the status bar), and its
		// thumb depends on its size alone.
		signature: () => [root, wrapper, table, shell, ...watchedBoxes].map((el, i) => {
			const r = el.getBoundingClientRect();
			const size = `${Math.round(r.width * 2)},${Math.round(r.height * 2)}`;
			return i < 4 ? `${Math.round(r.left * 2)},${Math.round(r.top * 2)},${size}` : size;
		}).join('|') + `|${wrapper.scrollWidth},${wrapper.scrollHeight},${wrapper.clientWidth},${wrapper.clientHeight}`,
		isBusy: () => hooks.stripCellBusy(),
		nextFrame: fn => { window.requestAnimationFrame(fn); },
	});

	// The one observer for the layout: the boxes below are the ones every consumer reads. box:'border-box'
	// on root and wrapper, not the default content-box: their rendered size (what getBoundingClientRect(),
	// and therefore updateOuterFrame, reads) changes on a padding-only update too (hover adds --bt-sel-pad),
	// which never touches the content box. prepareLayout/restoreLayout call updateOuterFrame() directly
	// for that case; this is the backstop for any size-affecting change neither of them caused.
	layoutSync.register('place', { read: () => computeVisibleGeom(), write: (geom: VisibleGeom) => hooks.repositionCtrlCol(geom) });
	const layoutObserver = new ResizeObserver(() => layoutSync.run());
	layoutObserver.observe(root, { box: 'border-box' });
	layoutObserver.observe(wrapper, { box: 'border-box' });
	layoutObserver.observe(table);
	component?.register(() => layoutObserver.disconnect());
	/** A box only one consumer cares about (a scrollbar track) is watched by the same observer. */
	const watchLayout = (el: HTMLElement) => { watchedBoxes.push(el); layoutObserver.observe(el); };

	// A resize the browser has no way of reporting (a column dragged, the page zoomed) says so itself.
	table.addEventListener('bt-layout-changed', (e: Event) => { hooks.markStripsStale((e as CustomEvent<{ axis?: StripAxis }>).detail?.axis); layoutSync.schedule(); });

	// Whether the row/column selector strips exist: the table can do something they offer. The space reserved above
	// and to the left of the table follows from it, so it is decided once, here.
	const hasSelectors = edits.canAny(SELECTOR_STRIP_OPS);
	// How far left of the table's visible edge the ctrl column needs to clear.
	// The full SEL_UNIT+AUTOFIT_OFFSET amount is sized to sit just left of the
	// row SELECTOR strip (see AUTOFIT_OFFSET's own doc comment) — irrelevant on
	// a table with no selectors (a locked one), whose toolbar is SEL_CELL wide.
	// Reserving room for a selector strip that will never exist would push the
	// toolbar, and the whole table, further right than it needs to be.
	const CTRL_COL_LEFT_GAP = hasSelectors ? (SEL_UNIT + AUTOFIT_OFFSET + 4) : (SEL_CELL + 4);

	// With a title, the SEL_UNIT portion of this reservation moves onto the
	// title's own margin-bottom instead (see titleEl's own --bt-title-sel-pad,
	// set right after it's created below) — root's padding-top only carries
	// it when there's NO title, i.e. root's padding-top actually sits
	// directly above the table (its only content in that case). Without this
	// split, the reservation stacked onto root's padding-top unconditionally
	// pushed the title itself down by SEL_UNIT instead of opening a gap
	// where the column-selector strip actually anchors (just above the
	// table), which the strip then rendered directly over — reported as the
	// title being covered by the strip on hover.
	// The whole top reservation in one place: the fixed edge gap, plus the column-selector strip's height when there is no title.
	const TOP_STRIP_PAD = VIEW_EDGE_GAP + (model.title ? 0 : (hasSelectors ? SEL_UNIT : 0));
	// Reserved from the very first paint and never collapsed (see restoreLayout), for every table including read-only ones.
	root.setCssProps({ '--bt-sel-pad': `${TOP_STRIP_PAD}px` });

	// Reserves --bt-sel-pad-left (root's own padding-left) when a wide table fills
	// its container flush-left, leaving no natural margin for the row selector +
	// ctrl column to sit in on the left. Extracted out of prepareLayout (below,
	// only assigned a real implementation when the table has selector strips, i.e.
	// selector strips exist) so the CTRL COLUMN — which stays visible while a
	// table is locked via .is-locked, with no row/col selectors at all in that
	// state — can still call this on its own. Without it, a wide LOCKED table's
	// unlock button rendered at a negative left with nothing reserving room for
	// it, landing permanently off-screen (reported: wide table, once locked,
	// permanently hides the top-left unlock button — narrow tables have enough
	// natural margin there regardless, which is why this only ever showed up on
	// a wide one).
	const reserveLeftPad = () => {
		const wr0 = wrapper.getBoundingClientRect();
		const rr0 = root.getBoundingClientRect();
		const leftNeed = CTRL_COL_LEFT_GAP;
		// Subtract whatever padding-left this function itself already reserved
		// (never collapsed back to 0 — same permanent-reservation reasoning as
		// --bt-sel-pad above) before measuring room, so repeat calls are
		// idempotent. Without this, wr0.left already includes OUR OWN prior
		// reservation (wrapper sits inside root, shifted right by root's own
		// padding) — a second call would measure plenty of "room" (the padding
		// it's currently sitting in), conclude none is needed, and reset it back
		// to 0, undoing the first call. Reproduced: the ctrl column (which calls
		// this from every mouseenter, unlike the selector strips' prepareLayout,
		// which only ever gets a fresh measurement right after restoreLayout
		// resets this same property back to 0 on mouseleave) landed correctly on
		// first paint and then snapped back off-screen the moment the pointer
		// actually entered the table.
		const currentPad = parseFloat(root.style.getPropertyValue('--bt-sel-pad-left')) || 0;
		// (wr0.left - rr0.left) is visual (both getBoundingClientRect); currentPad
		// is the LOGICAL px this function itself already wrote into --bt-sel-pad-left
		// — dividing only the visual term keeps the subtraction in one consistent
		// (logical) unit, same correction shape as scrollContentOffset's own.
		const leftRoom = (wr0.left - rr0.left) / view.zoom - currentPad;
		const leftPad = leftRoom < leftNeed ? Math.ceil(leftNeed - leftRoom) : 0;
		if (leftPad === currentPad) return;
		// A manually-set view width (--bt-view-width) is a FIXED, border-box width
		// on root — reserving padding-left there doesn't grow root, it shrinks the
		// content area (and therefore wrapper's own clientWidth) by the same
		// amount. If the user had scrolled wrapper all the way to its right edge,
		// that shrink silently un-maxes scrollLeft (the max is now
		// scrollWidth-clientWidth, a bigger number than before) — the table visibly
		// "retreats" from the edge the user explicitly scrolled to (reported:
		// dragging to the far right, leaving, then re-hovering the table moved the
		// scrollbar back). Re-pin to the new max in that case, same idea as a chat
		// UI keeping its scroll pinned to the bottom across a resize.
		const wasAtMaxScroll = wrapper.scrollWidth - wrapper.clientWidth - wrapper.scrollLeft < 1;
		root.setCssProps({ '--bt-sel-pad-left': `${leftPad}px` });
		if (wasAtMaxScroll) wrapper.scrollLeft = wrapper.scrollWidth - wrapper.clientWidth;
	};

	// One <col> per visible column (and one per run of hidden ones) names the columns for the code that measures them.
	// Widths live on the cells (applyColStyle); the table is always laid out by the browser.
	const colgroup = table.createEl('colgroup');
	const visibleCols: { colEl: HTMLElement; colIdx: number }[] = [];
	for (let ci = 0; ci < model.columns.length; ci++) {
		const col = model.columns[ci];
		if (col?.hidden) {
			while (ci < model.columns.length && model.columns[ci]?.hidden) ci++;
			ci--;
			colgroup.createEl('col');
			continue;
		}
		if (!col) continue;
		const colEl = colgroup.createEl('col');
		colEl.dataset.col = String(ci);
		colEl.setAttribute('data-col-id', col.id);
		visibleCols.push({ colEl, colIdx: ci });
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

	// The model does not change while this render lives (a write-back rebuilds the table), so the merges are
	// resolved once; resolving them walks every row for every merge.
	const mergeBounds = resolveMergeBounds(model);
	const effectiveSelRect = (): { r1: number; r2: number; c1: number; c2: number } | null =>
		sel.start && sel.end ? expandToMerges(mergeBounds, sel.start, sel.end) : null;

	const clearSel = () => {
		sel.start = sel.end = null;
		sel.hasMoved = false;
		ownCells(table).forEach(e => e.removeClass('bt-selected'));
		hooks.updateStatusBarStats();
	};

	const updateHighlights = () => {
		// The selection is the same for every cell of this pass.
		const rect = effectiveSelRect();
		ownCells(table).forEach(e => {
			const row = parseInt(e.dataset.row ?? '-1');
			const col = parseInt(e.dataset.col ?? '-1');
			if (row >= 0 && col >= 0) e.toggleClass('bt-selected', !!rect && row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2);
		});
		hooks.updateStatusBarStats();
	};

	/** Move the single-cell keyboard selection, ignoring a clamped (null) target. */
	const selectCell = (next: NavCell | null) => {
		if (!next) return;
		sel.start = next;
		sel.end   = next;
		updateHighlights();
	};

	// Handed to every cell editor: how it wants the selection to end up once it
	// closes (see EditNavigateHandler). Only this side knows the grid, so a
	// direction resolves to a real cell here, via cellNav.
	const onEditNavigate: EditNavigateHandler = (rowIdx, colIdx, move) => {
		const from: NavCell = { row: rowIdx, col: colIdx };
		if (move === 'stay') { selectCell(from); return; }
		const dir = move === 'next' ? 'right' : move === 'prev' ? 'left' : move;
		// Falling back to `from` matters: the editor has already committed and closed
		// by now, so a move clamped at the table's edge would otherwise leave the
		// cell neither edited nor selected — the keyboard would have nothing to
		// resume from.
		selectCell(moveCell(model, occupied, from, dir) ?? from);
	};

	let selectionPanel: HTMLElement | null = null;
	/** Auto-fill for a row/column selection: each selected column (or row) is its own run. */
	const autoFillOp = (axis: 'row' | 'col', lo: number, hi: number): CellOpEntry | undefined => {
		if (!edits.can('fill-cells')) return undefined;
		const runs = fillRuns(axis, model.rows.map(r => r.id), model.columns.map(c => c.id), lo, hi);
		const length = runs[0]?.cells.length ?? 0;
		if (length === 0) return undefined;
		return { icon: 'list-ordered', label: t('fillMenu'), emits: ['fill-cells'], action: () => {
			new FillSequenceModal(app, length, values => {
				for (const fill of runs) run({ type: 'fill-cells', cells: fill.cells, values });
			}).open();
		} };
	};

	const removeSelectionPanel = () => { selectionPanel?.remove(); selectionPanel = null; };

	/** Empties every selected cell. Data cells go in one op (which also drops their formulas); header cells are column names. */
	const clearCellsOp = (r1: number, r2: number, c1: number, c2: number): CellOpEntry => ({
		icon: 'eraser', label: t('clearCells'), emits: ['fill-cells'],
		action: () => {
			const cells: { rowId: string; colId: string }[] = [];
			for (let r = Math.max(r1, 1); r <= r2; r++) {
				const rid = rowId(model, r);
				if (!rid || isRowFiltered(r, model)) continue;
				for (let c = c1; c <= c2; c++) {
					const cid = colId(model, c);
					if (cid) cells.push({ rowId: rid, colId: cid });
				}
			}
			if (cells.length > 0) run({ type: 'fill-cells', cells, values: cells.map(() => '') });
			if (r1 === 0) for (let c = c1; c <= c2; c++) onCellChange(0, c, '');
		},
	});

	// Whether the panel for a selected range offers anything that changes the table; "select all" leads to it only
	// then. The panel itself opens for any range, with at least the entries that copy.
	const canEditSelection = edits.canAny(SELECTION_PANEL_OPS);
	const showSelectionPanel = () => {
		if (!sel.start || !sel.end) return;
		removeSelectionPanel();

		const rect = effectiveSelRect();
		if (!rect) return;
		const { r1, r2, c1, c2 } = rect;

		const selectedEls = ownCells(table).filter(cell => {
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
			styleEditable: edits.can('set-range-style'),
			cellOps: withEdits([
				{ icon: 'combine', label: t('mergeCells'), emits: ['merge-cells'],
					action: () => run({ type: 'merge-cells', anchorRowId: r1RId, anchorColId: c1CId, endRowId: r2RId, endColId: c2CId }) },
				// Row ops only for data selections (header row cannot be hidden/deleted)
				...(!isHeaderSel ? [
					{ icon: 'eye-off', label: hideRowsLabel(r1, r2), emits: ['hide-row'],
						action: () => { for (let ri = r1; ri <= r2; ri++) { const id = rowId(model, ri); if (id) run({ type: 'hide-row', rowId: id }); } } },
					{ icon: 'trash', label: deleteRowsLabel(r1, r2), danger: true, emits: ['delete-row'],
						action: () => { for (let ri = r2; ri >= r1; ri--) { const id = rowId(model, ri); if (id) run({ type: 'delete-row', rowId: id }); } } },
				] as CellOpEntry[] : []),
				{ icon: 'eye-off', label: hideColsLabel(c1, c2, colIndexToLetter), emits: ['hide-col'],
					action: () => { for (let ci = c1; ci <= c2; ci++) { const id = colId(model, ci); if (id) run({ type: 'hide-col', colId: id }); } } },
				{ icon: 'trash', label: deleteColsLabel(c1, c2, colIndexToLetter), danger: true, emits: ['delete-col'],
					action: () => { for (let ci = c2; ci >= c1; ci--) { const id = colId(model, ci); if (id) run({ type: 'delete-col', colId: id }); } } },
				{ divider: true },
				{ ...buildAlignCellOp(existingStyle.align, (align) => run({ type: 'set-align', target: rangeTarget, align })), emits: ['set-align'] },
				{ divider: true },
				clearCellsOp(r1, r2, c1, c2),
				{ icon: 'copy', label: t('copyToExcel'),
					action: () => copyRangeToClipboard(model, r1, r2, c1, c2) },
				{ icon: 'file-text', label: t('copyToMarkdown'),
					action: () => copyRangeAsMarkdown(model, r1, r2, c1, c2) },
			], edits),
			onApplyStyle: (bg, color, size, bold, italic) => run({ type: 'set-range-style', target: rangeTarget, bg, color, size, bold, italic }),
			onClose: () => { clearSel(); selectionPanel = null; },
		});
	};

	// Delegate drag events on tbody so we don't add listeners to every cell
	// (mousedown/mouseover use the cell's data-row/col attributes)

	const thead = table.createEl('thead');
	const headerTr = thead.createEl('tr');
	await renderRow({
		tr: headerTr, rowIdx: 0, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader: true,
		edits, merges, styleOf, onCellChange, columnKinds, cacheKey, getSingleClickEdit, onEditNavigate,
	});

	const tbody = table.createEl('tbody');

	// ── Cell drag-select (renderCellDragSelect.ts) ──
	renderCellDragSelect({
		cellsEditable: edits.can('set-cell-content'), table, formulaPick, sel, clearSel, updateHighlights, removeSelectionPanel, showSelectionPanel,
	});

	// ── Row/cell hover highlight (merge-aware) (renderHover.ts) ──
	const { resetHover } = renderHover({
		component, table, sel, clearSel, isSelectionPanelOpen: () => selectionPanel !== null, removeSelectionPanel,
	});

	// ── Keyboard cell navigation, Selected state (see cellNav.ts) (renderKeyboard.ts) ──
	renderKeyboard({
		model, component, edits, onCellChange, occupied, table, sel, effectiveSelRect, selectCell,
	});

	// ── Table body ───────────────────────────────────────────────────────────
	const visibleCellCount = countVisibleCells(model);
	// How many leading display rows a header-anchored merge reaches into —
	// those rows' <tr> must be hosted in thead too (see computeHeaderRowSpan's
	// own doc comment for why rowspan needs this).
	const headerRowSpan = computeHeaderRowSpan(model);
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
		if (edits.can('toggle-collapse')) {
			td.addEventListener('click', () => run({ type: 'toggle-collapse' }));
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
				if (edits.can('show-row-group')) {
					td.addEventListener('click', () =>
						run({ type: 'show-row-group', rowIds: groupIds }));
				}
				continue;
			}
			const displayIdx = di + 1; // 1-based: 0 = header
			if (isRowFiltered(displayIdx, model)) { di++; continue; }
			// A row a header-anchored merge reaches into is hosted in thead
			// instead — everything about it (model data, sort/filter/formula
			// eligibility, event handling below) stays completely normal; only
			// its DOM parent changes, so rowspan never has to cross into tbody.
			const tr = displayIdx < headerRowSpan ? thead.createEl('tr') : tbody.createEl('tr');
			await renderRow({
				tr, rowIdx: displayIdx, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader: false,
				edits, merges, styleOf, onCellChange, columnKinds, cacheKey, getSingleClickEdit, onEditNavigate,
				onEnterFormulaMode: (insertText) => formulaPick.enter(insertText),
				onExitFormulaMode: () => formulaPick.exit(),
			});
			di++;
		}
		renderAggregateRows(tbody, model);
		if (rowJump) renderRowJump(table, model, rowJump);
	}

	// Re-apply the Selected highlight carried across the rebuild. Has to happen
	// after the rows are built, since updateHighlights() walks the rendered cells.
	if (restoredSel) {
		sel.start = restoredSel;
		sel.end   = restoredSel;
		updateHighlights();
	}

	// TODO: filter status bar ("Showing X of Y rows · Clear filter") — deferred until
	// a unified table status bar is designed that can also host sort info.

	// ── Footer ───────────────────────────────────────────────────────────────
	// Inside wrapper (before addRowBtn, see renderFooter's own comment) — NOT
	// container's default, which would land the footer below wrapper's entire
	// box, horizontal scrollbar included.
	const footerEl = renderFooter(wrapper);
	// Caps the footer's own width to contentRow's (table + addColBtn) rendered
	// width, wrapping onto more lines instead of continuing to widen wrapper
	// past the table itself (reported: "脚注的最大宽度应该不超过表格本身的宽
	// 度，超过之后应该自动换行"). Same --strip-max-width pattern addRowBtn
	// already uses just below (contentRow.getBoundingClientRect().width /
	// zoom) — kept live via a ResizeObserver on the table, so a column resize (or the view-width drag) reflows the
	// footer's own wrap points immediately, not just on the next full render.
	// Unconditional (unlike positionEdgeStrips' own --strip-max-width write,
	// which exists only where the add strips do) — a locked/read-only table has a footer
	// too and needs the same cap.
	if (footerEl) {
		const readFooter = () => contentRow.getBoundingClientRect().width / view.zoom;
		const writeFooter = (width: number) => { footerEl.setCssProps({ '--bt-footer-max-width': `${width}px` }); };
		writeFooter(readFooter());
		layoutSync.register('place', { read: readFooter, write: writeFooter });
	}

	// ── Status bar and outer frame (renderStatusBarDom.ts) ──
	renderStatusBar({
		model, edits, forceStatusBarPinned, shell, root, wrapper, table, view, hooks, sel, layoutSync, watchLayout,
		ctrlColLeftGap: CTRL_COL_LEFT_GAP,
	});

	// ── Frozen rows/columns (renderFreezeDom.ts) ──
	renderFrozenCells({
		model, hooks, view, table, layoutSync, thead, tbody, resetHover,
	});

	// ── Edge-hover add strips (renderEdgeStrips.ts) ──
	renderEdgeStrips({
		model, isSwapping, edits, hooks, root, view, wrapper, contentRow, computeVisibleGeom, layoutSync,
	});

	// ── Vertical scrollbar (renderVScroll.ts) ──
	renderVScroll({
		model, wrapper, contentRow, computeVisibleGeom, layoutSync, watchLayout,
	});

	// ── Control column (the toolbar on the left) (renderCtrlCol.ts) ──
	const hasCtrlButtons = renderCtrlCol({
		model, edits, actions, hiddenCtrlColButtons, forceStatusBarPinned, registry, hooks, root, view, wrapper, computeVisibleGeom, ctrlColLeftGap: CTRL_COL_LEFT_GAP, reserveLeftPad, visibleCols, sel, updateHighlights, showSelectionPanel, canEditSelection,
	});

	// ── Strip padding ─────────────────────────────────────────────────────────
	// Turns on the padding reservation and the resting-state clip-path that every
	// strip on the table's edges (row/col selectors, edge-add "+" buttons, the
	// toolbar) depends on — see .bt-render-root.bt-has-strips in styles.css.
	// A table with only its toolbar (a locked one) needs it too: without the class,
	// reserveLeftPad's --bt-sel-pad-left has no rule consuming it, and a wide
	// table's toolbar lands off-screen.
	const hasStrips = hasSelectors || hasCtrlButtons;
	if (hasStrips) root.addClass('bt-has-strips');

	// ── Row / column selector strips (renderSelectorStrips.ts) ──
	renderSelectorStrips({
		model, getRegistry, component, edits, registry, hooks, root, view, wrapper, table, computeVisibleGeom, layoutSync, topStripPad: TOP_STRIP_PAD, reserveLeftPad, clearSel, autoFillOp, thead, tbody,
	});

	// ── Show/hide overlays on mouse enter/leave (renderOverlays.ts) ──
	renderOverlays({
		component, hasSelectors, hasStrips, hooks, shell, root, table, reserveLeftPad,
	});

}


