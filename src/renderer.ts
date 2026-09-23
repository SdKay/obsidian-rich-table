import { App, Component, Menu, Notice, setIcon } from 'obsidian';
import {
	t, isZh, aggLabel,
	hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel,
	collapsedRowsLabel, statusBarStatsLabel,
} from './i18n';
import { BUILTIN_THEMES } from './themes/index';
import type { TableModelV2, AggType, CtrlColButtonId } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import { colIndexToLetter } from './utils';
import { SEL_TOTAL, SEL_CELL, AUTOFIT_OFFSET } from './selectorLayout';
import { hasRowSpanningMerge, sortRowsByColumn, applySortForDisplay } from './renderSort';
import type { OpHandler, ToggleLockHandler, CellChangeHandler, ColTypeChangeHandler, StructuralOpHandler, EditNavigateHandler, SnapshotKind } from './renderTypes';
import { rowId, colId, isRowFiltered, buildOccupied, countVisibleCells, getMergeOrigin, resolveCellValue, resolveMergeBounds, computeHeaderRowSpan } from './renderGridHelpers';
import { cellIdsToLabel, rangeIdsToLabel } from './formulaLabel';
import { moveCell, clampToValidCell, type NavCell } from './cellNav';
import { takeSelectedCell } from './renderSelectionHandoff';
import { cellEffectiveStyle } from './renderCellStyle';
import { copyRangeToClipboard, copyRangeAsMarkdown, parseHtmlTableWithMerges, parseMarkdownPipeTable } from './renderClipboard';
import { enterLineEdit } from './renderEditMode';
import { colMinWidth } from './renderAutofit';
import { setupColResize, bindResizeHandle } from './renderResize';
import { selectorAxisOffset, computeVisibleGeom as computeVisibleGeomPure, type VisibleGeom } from './renderGeometry';
import { applyZoom, zoomFactor, renderZoomControl } from './renderZoom';
import { bindScrollSync } from './renderScrollSync';
import { type CellOpEntry, openCellPanel, buildAlignCellOp } from './renderPanel';
import { renderRow, triggerPrimaryAction } from './renderCell';
import { renderAggregateRows, activeAggTypes, AGG_ORDER } from './renderAggregate';
import { isHoverPinned, onHoverUnpinned, showMenuPinned, getActiveCellMenu } from './renderHoverPin';
import { renderKanbanBoard } from './renderKanban';
import { renderCalendarBoard } from './renderCalendar';
import { renderViewToolbar, buildViewSwitcherMenu } from './renderViews';
import { NESTED_CACHE_KEY_MARKER } from './blockCacheKey';
import { applyFreeze } from './renderFreeze';
import { ownCells, ownCols, ownRows } from './renderOwnScope';
import { canFreezeRows, canFreezeCols } from './operations';
import { computeSelectionStats } from './renderStatusBar';

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
	/** Left-toolbar "open in default app" button — only meaningful for an
	 *  xlsx-backed table (see TableModelV2.xlsxSource): the ctrlCol otherwise
	 *  only appears alongside onStructuralOp/onToggleLock, neither of which an
	 *  xlsx-backed (view-only) table ever has, so this is its own gate rather
	 *  than folded into either of those. */
	onOpenExternalFile?: () => void,
	/** Left-toolbar "convert to plain table" button — same xlsx-only gate as
	 *  onOpenExternalFile above. Snapshots the currently-loaded xlsx content
	 *  into the block's own YAML and drops xlsxSource, turning a view-only
	 *  reference into a normal, fully-editable rich-table (see
	 *  tableBlock.ts's detachFromXlsx). */
	onDetachFromXlsx?: () => void,
	/** View-outer-edge drag-resize, for an xlsx-backed table specifically —
	 *  same xlsx-only gate as onOpenExternalFile/onDetachFromXlsx above, and
	 *  deliberately its OWN pair of callbacks rather than routing through
	 *  onStructuralOp: onStructuralOp being defined at all turns on every
	 *  OTHER editing affordance too (cell double-click, row/col drag-resize,
	 *  right-click menus, …), which an xlsx-backed table must never offer
	 *  (see tableBlock.ts's isXlsxBacked doc comment) — resizing the VIEW
	 *  itself is the one edit-shaped action that's actually safe here, since
	 *  it's shell/view state (like viewWidth/viewHeight always were), not
	 *  table data. */
	onSetViewWidth?: (width: number) => void,
	onSetViewHeight?: (height: number) => void,
	/** Left-toolbar snapshot button — the ONE ctrlCol entry with no gate at
	 *  all (see the ctrlCol comment below): capturing an image of a table
	 *  doesn't depend on whether editing/locking/xlsx-linking apply to it. */
	onSnapshot?: (kind: SnapshotKind) => void,
	/** Phase 1 of xlsx WRITE support (see CLAUDE.md's "xlsx write support"
	 *  section): a SEPARATE, narrower entry point than onOp — passed only for
	 *  an xlsx-backed table, and only ever asked to carry the safe subset of
	 *  ops (xlsxSource.ts's XlsxWritableOp) that queueOp's isXlsxBacked branch
	 *  knows how to route to the real file. Deliberately not folded into onOp:
	 *  onOp being defined at all turns on every OTHER editing affordance too
	 *  (sort/filter/style/row-col insert-delete/freeze/…), which an
	 *  xlsx-backed table must still never offer — only onCellChange (content
	 *  edits, below) and onMergeOp (existing-merge unmerge, below) ever get
	 *  built from this. */
	onXlsxWrite?: OpHandler,
	/** Left-toolbar "Export as .xlsx" button — same no-edit-state-gate
	 *  treatment as onSnapshot above (exporting is read-only, so it doesn't
	 *  care whether the table is locked/collapsed/etc.); gated instead on
	 *  tableBlock.ts's side to ONLY a native table, never an xlsx-backed one
	 *  (which already has its own "open in default app"/"convert to plain
	 *  table" buttons for essentially the same destination). */
	onExportXlsx?: () => void,
	/** Per-scenario left-toolbar button visibility (settings.ts's
	 *  "Left-toolbar buttons" section, model.ts's CtrlColButtonId) — ids in
	 *  this set are skipped when building ctrlCol below, regardless of
	 *  whether their own callback is defined. tableBlock.ts derives this set
	 *  from BetterTableSettings.ctrlColHiddenButtons[scenario], picking the
	 *  scenario (locked/unlocked/xlsxRef) the SAME way it already derives every
	 *  other per-scenario callback gate above. Deliberately a plain Set, not
	 *  threaded through onOp/onToggleLock/etc. themselves — hiding a button is
	 *  a display-only preference, not a change to what operations are actually
	 *  ALLOWED (e.g. hiding "lock" doesn't stop onToggleLock from working if
	 *  reached some other way), so it stays a separate, additive filter over
	 *  the same gates rather than replacing any of them. */
	hiddenCtrlColButtons?: ReadonlySet<CtrlColButtonId>,
	/** True when this table is one sheet of a 2+-sheet workbook — the sheet
	 *  tabs (mounted into .bt-status-tabs, see tableBlock.ts) are the only way
	 *  to switch sheets at all, so `model.statusBarMode === 'hover'` is
	 *  overridden to always show the bar here regardless of that per-sheet
	 *  preference: hiding the bar in that case wouldn't just hide stats, it
	 *  would hide the workbook's own sheet navigation. A single-sheet table's
	 *  own hover preference (if any) is untouched — this only forces pinned
	 *  ON, never forces it off. */
	forceStatusBarPinned?: boolean,
): Promise<void> {
	if (model.columns.length === 0) return;
	// Sort is a display-only transform: reorder a LOCAL copy of `rows` (never the
	// object the caller holds for write-back) so every existing display-index-based
	// lookup below (rowId(), isRowFiltered(), cellRawValue(), etc.) keeps working
	// unmodified — display index and storage index are the same again after this.
	model = applySortForDisplay(model, getRegistry());
	// Unified op handler — replaces separate onCellChange / onColTypeChange / onStructuralOp.
	// Wrapped as void-returning so helpers typed StructuralOpHandler=(op)=>void are satisfied.
	// Deliberately sourced from onOp ALONE, not onXlsxWrite — this is the gate
	// behind sort/filter/style/insert/delete/freeze/etc., every one of which
	// stays off for an xlsx-backed table (see onXlsxWrite's own doc comment).
	const onStructuralOp: StructuralOpHandler | undefined = onOp ? (op) => void onOp(op) : undefined;

	// Cell content writes (data AND header text) are safe to allow through
	// onXlsxWrite too — this callback's own dispatch logic only ever produces
	// 'set-col-name'/'set-cell-content', both inside the xlsx-writable set.
	const cellWriteOp = onOp ?? onXlsxWrite;
	// Adapter: row/col-index-based callbacks used by inner helper functions.
	// rowIdx=0 → header (set-col-name); rowIdx≥1 → data cell (set-cell-content).
	const onCellChange: CellChangeHandler | undefined = cellWriteOp ? (ri, ci, value) => {
		if (ri === 0) {
			void cellWriteOp({ type: 'set-col-name', colId: colId(model, ci), name: value });
		} else {
			// Editing a merge's effective anchor (possibly promoted past a hidden literal
			// anchor, see getMergeOrigin) must write to the merge's literal anchor cell —
			// this row may just be standing in for a hidden anchor and has no data of its own.
			const merge = getMergeOrigin(ri, ci, model);
			const targetRowId = merge?.anchorRowId ?? rowId(model, ri);
			const targetColId = merge?.anchorColId ?? colId(model, ci);
			void cellWriteOp({ type: 'set-cell-content', rowId: targetRowId, colId: targetColId, value });
		}
	} : undefined;

	// Merge/unmerge only — a second, narrower derived handler alongside
	// onStructuralOp (which stays xlsx-undefined). Threaded ONLY into the
	// unmerge entry in dataCellOps/the header cell panel below, so an
	// xlsx-backed table can undo an existing merge without lighting up every
	// other onStructuralOp-gated entry those same call sites also build
	// (split-cell, hide/delete row/col, align, …), none of which are in
	// phase 1's writable set. Creating a NEW merge (drag-select → "Merge
	// cells") isn't wired to this yet — that action lives behind the
	// range-selection panel, which is gated on onStructuralOp for its OTHER
	// entries too and isn't reachable at all for an xlsx-backed table today
	// (see the mousedown listener's own onStructuralOp guard, added so a
	// locked/xlsx table keeps native text selection) — left as a follow-up.
	const onMergeOp: StructuralOpHandler | undefined = cellWriteOp ? (op) => void cellWriteOp(op) : undefined;

	const onColTypeChange: ColTypeChangeHandler | undefined = onOp
		? (ci, colType) => void onOp({ type: 'set-col-type', colId: colId(model, ci), colType })
		: undefined;

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
	let showEdgeStrips    = () => { /* assigned in edge block */ };
	let hideEdgeStrips    = () => { /* assigned in edge block */ };
	// Read by bindScrollSync's shared isActive() check (selector block, below) —
	// addRowBtn/addColBtn themselves are block-scoped to the edge-strip block and
	// unreachable from there otherwise.
	let isEdgeStripsVisible = () => false;
	let showSelectors     = () => { /* assigned in selector block */ };
	let hideSelectors     = () => { /* assigned in selector block */ };
	let prepareLayout     = () => { /* assigned in selector block */ };
	let restoreLayout     = () => { /* assigned in selector block */ };
	let repositionLockBtn    = () => { /* assigned in lock-button block */ };
	let repositionAutoFitBtn = () => { /* assigned in auto-fit-button block */ };
	// Optional `geom` — bindScrollSync (below) computes the shared frame's
	// geometry once and passes it to all three of these, instead of each
	// independently recomputing identical geometry (see that module's own
	// doc comment). Every OTHER call site (resize observers, mouseenter,
	// drag-resize) omits it and gets a fresh computeVisibleGeom() as before.
	let repositionCtrlCol    = (_geom?: VisibleGeom) => { /* assigned in ctrl-column block */ };
	// Cheap, rebuild-free repositioning (no visibility toggle, no per-cell
	// rebuild) — hoisted so the width/height drag-resize handles below can keep
	// the strips tracking the view's live size during a drag, the same way the
	// wrapper's own scroll listener already does for scroll (see those call
	// sites for precedent: they call positionSelectors()/positionEdgeStrips()
	// directly, never showSelectors()/rebuild(), specifically to stay cheap
	// enough to run on every event in a fast-firing loop).
	let repositionSelectorStrips = (_geom?: VisibleGeom) => { /* assigned in selector block */ };
	let repositionEdgeStrips     = (_geom?: VisibleGeom) => { /* assigned in edge block */ };
	let updateStatusBarStats     = () => { /* assigned in status-bar block */ };
	// Assigned below (drag-resize-handle block) to the height-resize handle's
	// mount function — invoked much later, once the status bar exists, since
	// the handle attaches to ITS bottom edge rather than root's (see Task 8's
	// comment at the call site). No-op by default so a locked table (no
	// onStructuralOp) simply never mounts it, matching every other edit-only
	// handle's existing gate.
	let mountHeightResizeHandle  = (_container: HTMLElement) => { /* assigned in drag-resize-handle block if editable */ };
	// Assigned once the status bar exists (below) — the outer frame's bottom
	// edge must extend to include a hover-mode status bar while it's showing,
	// which only that block knows how to check (see the frame element's own
	// creation comment for why this can't just read `shell`'s own rect).
	let updateOuterFrame = () => { /* assigned once statusBar exists */ };
	// Assigned in the frozen-rows/columns block, once thead/tbody exist — lets
	// the drag-resize handle (defined earlier) keep frozen offsets exactly in
	// step with the geometry it just wrote live, instead of waiting on
	// freezeResizeObs's own rAF-coalesced re-measure (a real one-frame lag,
	// visible as the frozen column stuttering during a slow drag).
	let reapplyFreezeNow = () => { /* assigned in frozen-rows/columns block */ };

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
	// bar to match. A `shell` child, not `root`'s, specifically so it CAN
	// extend past root's own box: a hover-mode status bar (position:absolute,
	// never contributing to root's or shell's own layout box — see
	// positionStatusBar's own comment) needs the frame to grow down around it
	// while it's showing and shrink back the instant it hides, without ever
	// touching root/shell's REAL layout size — which is exactly the scroll-
	// jump/document-height-collapse bug class the hover-status-bar's own
	// absolute-not-in-flow positioning was built to avoid in the first place
	// (see "Re-render flicker" elsewhere in this file's own history). A plain
	// decorative div computed from getBoundingClientRect() sidesteps that
	// entirely: growing/shrinking this box is just redrawing a rectangle,
	// never a layout change.
	const outerFrame = shell.createDiv({ cls: 'bt-outer-frame' });

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
		titleEl.setCssProps({ '--bt-title-sel-pad': `${SEL_TOTAL}px` });
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

	// The factor every zoom-aware geometry correction below divides by — see
	// renderGeometry.ts's own NO_ZOOM doc comment for why this is threaded as
	// a plain number rather than measured back off the DOM. `let`, not `const`:
	// the zoom control's live-drag preview (renderZoomControl's `applyLive`
	// below) changes the real CSS `zoom` on `root` immediately, without
	// waiting for the commit + full re-render that would otherwise refresh
	// this closure with a new value — so this needs to be kept in sync at the
	// same moment, or every ResizeObserver-driven geometry pass that fires
	// during the drag (rebuild()'s auto-column-width pin, applyFreeze) divides
	// by a now-stale factor. Confirmed via diagnostic logging: a table's
	// pinned width jumped by exactly (live%/stale%) — e.g. 1228px → 1365px,
	// a ratio of 100/90 — squeezing an auto-width column into a visible,
	// self-correcting wrap until the eventual commit's fresh render fixed it.
	let zoom = zoomFactor(model.zoom);

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
	let viewFrameScheduled = false;
	const viewFrameResizeObs = new ResizeObserver(() => {
		if (viewFrameScheduled) return;
		viewFrameScheduled = true;
		window.requestAnimationFrame(() => {
			viewFrameScheduled = false;
			repositionSelectorStrips();
			repositionCtrlCol();
			updateOuterFrame();
		});
	});
	// box:'border-box', not the default content-box — root's rendered size
	// (what getBoundingClientRect(), and therefore updateOuterFrame, actually
	// reads) changes on a padding-only update too (hover adds --bt-sel-pad),
	// which never touches the content box and so never fires a content-box
	// observer at all. prepareLayout/restoreLayout already call
	// updateOuterFrame() directly for that exact case (synchronous, no need to
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
	if (onStructuralOp || onSetViewWidth || onSetViewHeight) {
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
				let newW = r.width / zoom, newH = r.height / zoom;
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
						newW = Math.max(80, r.width / zoom + 2 * (ev.clientX - startX) / zoom);
						wrapper.addClass('bt-view-fixed-w');
						wrapper.setCssProps({ '--bt-view-width': `${Math.round(newW)}px` });
					}
					if (mode !== 'w') {
						newH = Math.max(60, r.height / zoom + (ev.clientY - startY) / zoom);
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
					// Explicit, synchronous call rather than relying solely on
					// viewFrameResizeObs (which also watches wrapper) — that
					// observer is rAF-coalesced (by design, to survive its own
					// reposition calls resizing wrapper again without looping
					// forever, see its own comment), which added one extra frame
					// of visible lag between the handle and the frame during a
					// width drag specifically (mode 'w'/'both') — not noticeable
					// for height, whose handle lives inside the status bar and has
					// no separate frame-edge dependency to catch up to.
					updateOuterFrame();
					// Same one-frame-lag reasoning as updateOuterFrame's own call —
					// freezeResizeObs (below) is rAF-coalesced, which reads as the
					// frozen column stuttering a pixel behind the cursor during a
					// slow drag (reported: "冻结列整体在抖动").
					reapplyFreezeNow();
				};
				const onUp = () => {
					handle.removeEventListener('pointermove', onMove);
					handle.removeEventListener('pointerup', onUp);
					if (mode !== 'h') {
						if (onStructuralOp) void onStructuralOp({ type: 'set-view-width', width: Math.round(newW) });
						else onSetViewWidth?.(Math.round(newW));
					}
					if (mode !== 'w') {
						if (onStructuralOp) void onStructuralOp({ type: 'set-view-height', height: Math.round(newH) });
						else onSetViewHeight?.(Math.round(newH));
					}
				};
				handle.addEventListener('pointermove', onMove);
				handle.addEventListener('pointerup', onUp);
			});
		};
		// bt-view-resize-b (height) mounts on the status bar's own bottom edge
		// instead of root's — deferred until that element exists (Task 8; see
		// mountHeightResizeHandle's own declaration above).
		mountHeightResizeHandle = (container: HTMLElement) => makeHandle('bt-view-resize-b', 'h', container);
		makeHandle('bt-view-resize-r', 'w', root);
		makeHandle('bt-view-resize-br', 'both', root);
	}

	// contentRow holds <table> and (in edit mode) addColBtn side by side via flex,
	// so addColBtn's height can be a plain `align-self: stretch` matching table's
	// own rendered height instead of a JS measurement — see addColBtn's creation
	// below for the full reasoning (mirrors why addRowBtn is a wrapper-level
	// sticky sibling rather than a root-level absolute overlay).
	const contentRow = wrapper.createDiv({ cls: 'bt-table-content-row' });
	const table = contentRow.createEl('table', { cls: 'bt-table' });

	// Visible-viewport geometry, all in root-relative px — see renderGeometry.ts's
	// own doc comment for the field-by-field meaning. Pulled out to a pure,
	// parameterized function there (shared with bindScrollSync, below) since
	// every caller here wants this closure's own table/root/wrapper anyway;
	// this local alias keeps every existing zero-arg call site unchanged. The
	// closure's own `zoom` factor flows through here too, for the same reason —
	// every one of THOSE call sites gets the correction for free without
	// individually knowing zoom exists.
	const computeVisibleGeom = () => computeVisibleGeomPure(table, root, wrapper, zoom);

	// How far left of the table's visible edge the ctrl column needs to clear.
	// The full SEL_TOTAL+AUTOFIT_OFFSET amount is sized to sit just left of the
	// row SELECTOR strip (see AUTOFIT_OFFSET's own doc comment) — irrelevant on
	// a locked table, which has no selectors at all (onStructuralOp gates them
	// off) and only ever shows the lock icon itself, SEL_CELL wide. Using the
	// smaller gap there specifically (not the full one "just to be safe") is
	// what was asked for once the bug above was fixed: reserving room for a
	// selector strip that will never exist just pushed the button, and the
	// whole table, further right than it needed to be.
	const CTRL_COL_LEFT_GAP = onStructuralOp ? (SEL_TOTAL + AUTOFIT_OFFSET + 4) : (SEL_CELL + 4);

	// Obsidian's own block-hover toolbar (the "</>" edit-source button, shown
	// while hovering ANY code block) floats at a fixed position over the
	// top-right of the whole rendered block — outside this plugin's control
	// entirely, since it's Obsidian's own chrome, not something in our DOM. A
	// title pushes the table down clear of it; without one, the table's own
	// top edge — where the column-selector strip and its resize handles live —
	// sits right underneath it (reported with screenshots: the toolbar's own
	// hit area covered the last column's resize seam, only reachable once the
	// pointer moved past it). The extra amount is a guess from those
	// screenshots, not a measurement against the real toolbar — this plugin's
	// e2e harness has no way to render Obsidian's own chrome to verify against
	// — so treat this as a starting point that may need retuning after a real
	// check in the app, not a settled constant.
	//
	// This toolbar can only ever float over a genuine top-level code block —
	// Obsidian's editor has no concept of a nested ```rich-table``` fence
	// (rendered via a recursive MarkdownRenderer.render() call, see
	// blockCacheKey.ts) as a hoverable block of its own, so the extra clearance
	// is a real, objective non-issue for one, not a preference. isNested here
	// answers exactly that fact — it does not otherwise change how a nested
	// table renders (see reserveSelectorLeftPad/statusBarPinned above, which
	// deliberately don't distinguish the two at all).
	const isNested = !!cacheKey?.includes(NESTED_CACHE_KEY_MARKER);
	// With a title, the SEL_TOTAL portion of this reservation moves onto the
	// title's own margin-bottom instead (see titleEl's own --bt-title-sel-pad,
	// set right after it's created below) — root's padding-top only carries
	// it when there's NO title, i.e. root's padding-top actually sits
	// directly above the table (its only content in that case). Without this
	// split, the reservation stacked onto root's padding-top unconditionally
	// pushed the title itself down by SEL_TOTAL instead of opening a gap
	// where the column-selector strip actually anchors (just above the
	// table), which the strip then rendered directly over — reported as the
	// title being covered by the strip on hover.
	const TOP_STRIP_PAD = model.title ? 0 : SEL_TOTAL + (isNested ? 0 : 28);

	// Reserves --bt-sel-pad-left (root's own padding-left) when a wide table fills
	// its container flush-left, leaving no natural margin for the row selector +
	// ctrl column to sit in on the left. Extracted out of prepareLayout (below,
	// only assigned a real implementation when onStructuralOp is present, i.e.
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
		const leftRoom = (wr0.left - rr0.left) / zoom - currentPad;
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
			if (col.width != null) {
				const w = Math.max(colMinWidth(), col.width);
				colEl.style.setProperty('width', `${w}px`);
				totalWidth += w;
			} else {
				// No width of its OWN while a sibling column has one (e.g. one just
				// inserted by split-cell-col/insert-col, or any column left to auto-
				// track its content on purpose) — this used to fall back to a flat
				// colMinWidth() floor, which isn't really "auto", just a smaller flat
				// number; a column marked this way instead gets measured against its
				// actual content and pinned to that, once the table is attached and
				// real content is rendered (applyAutoColWidths, called from
				// tableBlock.ts post-swap — measuring here would read 0, since this
				// runs before this table is ever attached to a live document). Left
				// out of totalWidth for the same reason: its real contribution isn't
				// known yet, and that same post-attach step corrects the table's
				// overall width once every auto column has a real pinned value.
				colEl.dataset.auto = '1';
			}
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

	/**
	 * The raw drag rectangle, expanded to fully contain any merge it only
	 * partly overlaps — matches Excel: touching part of a merged cell selects
	 * the whole merge, and a rectangular selection can never end up with a
	 * "notch" missing where a merge's other rows/columns should be. Iterates
	 * to a fixed point since expanding for one merge can newly overlap another
	 * (e.g. two merges chained end-to-end).
	 */
	const effectiveSelRect = (): { r1: number; r2: number; c1: number; c2: number } | null => {
		if (!sel.start || !sel.end) return null;
		let r1 = Math.min(sel.start.row, sel.end.row);
		let r2 = Math.max(sel.start.row, sel.end.row);
		let c1 = Math.min(sel.start.col, sel.end.col);
		let c2 = Math.max(sel.start.col, sel.end.col);
		let changed = true;
		while (changed) {
			changed = false;
			for (const m of resolveMergeBounds(model)) {
				if (m.rowHi < r1 || m.rowLo > r2 || m.colHi < c1 || m.colLo > c2) continue; // no overlap
				if (m.rowLo < r1) { r1 = m.rowLo; changed = true; }
				if (m.rowHi > r2) { r2 = m.rowHi; changed = true; }
				if (m.colLo < c1) { c1 = m.colLo; changed = true; }
				if (m.colHi > c2) { c2 = m.colHi; changed = true; }
			}
		}
		return { r1, r2, c1, c2 };
	};

	const inSel = (row: number, col: number): boolean => {
		const rect = effectiveSelRect();
		if (!rect) return false;
		return row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2;
	};

	const clearSel = () => {
		sel.start = sel.end = null;
		sel.hasMoved = false;
		ownCells(table).forEach(e => e.removeClass('bt-selected'));
		updateStatusBarStats();
	};

	const updateHighlights = () => {
		ownCells(table).forEach(e => {
			const row = parseInt(e.dataset.row ?? '-1');
			const col = parseInt(e.dataset.col ?? '-1');
			if (row >= 0 && col >= 0) e.toggleClass('bt-selected', inSel(row, col));
		});
		updateStatusBarStats();
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
	const removeSelectionPanel = () => { selectionPanel?.remove(); selectionPanel = null; };

	const showSelectionPanel = () => {
		if (!sel.start || !sel.end || (!onStructuralOp && !onMergeOp)) return;
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
		// Merge/unmerge only — see renderer.ts's onMergeOp doc comment (phase 1
		// of xlsx WRITE support): an xlsx-backed table has onMergeOp but not
		// onStructuralOp, so it gets JUST the "Merge cells" entry below, none of
		// the row/col/align/style ops that follow (all still gated on the real
		// onStructuralOp, unchanged from before).
		const mergeHandler = onStructuralOp ?? onMergeOp;
		selectionPanel = openCellPanel({
			component,
			anchor,
			els: selectedEls,
			styleTarget: rangeTarget,
			existingStyle,
			showTextColor: true,
			styleEditable: !!onStructuralOp,
			cellOps: [
				...(mergeHandler ? [{ icon: 'combine', label: t('mergeCells'),
					action: () => void mergeHandler({ type: 'merge-cells', anchorRowId: r1RId, anchorColId: c1CId, endRowId: r2RId, endColId: c2CId }) }] as CellOpEntry[] : []),
				...(onStructuralOp ? [
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
					buildAlignCellOp(existingStyle.align, (align) => void onStructuralOp({ type: 'set-align', target: rangeTarget, align })),
				] as CellOpEntry[] : []),
				{ divider: true },
				{ icon: 'copy', label: t('copyToExcel'),
					action: () => copyRangeToClipboard(model, r1, r2, c1, c2) },
				{ icon: 'file-text', label: t('copyToMarkdown'),
					action: () => copyRangeAsMarkdown(model, r1, r2, c1, c2) },
			],
			onApplyStyle: onStructuralOp
				? (bg, color, size, bold, italic) => void onStructuralOp({ type: 'set-range-style', target: rangeTarget, bg, color, size, bold, italic })
				: () => { /* style editing isn't in xlsx phase 1 */ },
			onClose: () => { clearSel(); selectionPanel = null; },
		});
	};

	// Delegate drag events on tbody so we don't add listeners to every cell
	// (mousedown/mouseover use the cell's data-row/col attributes)

	const thead = table.createEl('thead');
	const headerTr = thead.createEl('tr');
	await renderRow({
		tr: headerTr, rowIdx: 0, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader: true,
		onCellChange, onColTypeChange, onStructuralOp, onMergeOp, cacheKey, getSingleClickEdit, onEditNavigate,
	});

	const tbody = table.createEl('tbody');

	// ── Cell drag-select ─────────────────────────────────────────────────────
	// Unified across header AND data cells, attached at the table level rather
	// than separately to thead/tbody: a header-anchored merge can now reach
	// down into real data rows, and those rows are hosted in <thead> (see
	// computeHeaderRowSpan) purely so their rowspan renders correctly — a
	// thead/tbody-split pair of listeners would silently miss such a row
	// entirely (thead's old version only matched <th>, tbody's only fired for
	// descendants of <tbody>). Matching `[data-row][data-col]` regardless of
	// tag or physical parent means "is this the header" is decided purely by
	// the row VALUE (0), never by which element happened to contain it.
	const CELL_SELECTOR = 'td[data-row][data-col], th[data-row][data-col]';

	// Capture-phase: a mousedown+mouseup on another cell still fires a native
	// `click` afterward, which would otherwise reach THAT cell's own
	// bindCellActivation listener (registered directly on its <td>, bubble
	// phase) before bubbling up to anything registered here — by the time a
	// bubble-phase listener here could see it, the other cell would already
	// have opened its own editor and stolen focus (reproduced: reference
	// insertion worked, but focus jumped to the clicked cell). Capturing on
	// table runs BEFORE the target's own bubble listener, so swallowing it
	// here stops that from ever happening. A click inside the formula
	// editor's own cell is left alone — that's just normal caret placement.
	table.addEventListener('click', (evt: MouseEvent) => {
		if (!formulaEdit) return;
		if ((evt.target as HTMLElement).closest('.bt-editing')) return;
		evt.preventDefault();
		evt.stopPropagation();
	}, { capture: true });

	table.addEventListener('mousedown', (evt: MouseEvent) => {
		if (evt.button !== 0) return;
		// A locked table has no editing, no structural ops, and (showSelectionPanel's
		// own `!onStructuralOp` guard) no popup — so this custom drag-select/highlight
		// machinery leads nowhere for it, while its own `preventDefault()` below
		// actively blocks the ONE thing that DOES still work unassisted: the browser's
		// native click-and-drag text selection inside a cell, and Ctrl+C copying it.
		// Skip entirely and let that happen instead. Reported: locked tables offered
		// no way at all to copy a cell's content.
		// An xlsx-backed table (phase 1 of xlsx WRITE support) is the one exception:
		// it has onMergeOp even though onStructuralOp itself stays undefined, and
		// dragging across cells to create a NEW merge needs this same machinery —
		// showSelectionPanel's own gate below only offers the "Merge cells" entry
		// in that case, nothing else. Losing native drag-to-select-text here isn't
		// the same regression it would be for a locked table: unlike a locked
		// table, an xlsx-backed cell IS clickable into a real text editor (see
		// onCellChange above), so copying a cell's content is still one click away.
		if (!onStructuralOp && !onMergeOp) return;
		if (formulaEdit) {
			// A cell is mid-formula-edit — clicking ANOTHER cell inserts a
			// reference instead of the normal drag-select/open-editor behaviour.
			// A click inside the editor's OWN cell falls through to native caret
			// placement (formula text is plain, freely hand-editable). The
			// header can't be referenced by a formula at all, so a header click
			// here is simply a no-op, same as it always was for any other
			// non-referenceable target.
			if ((evt.target as HTMLElement).closest('.bt-editing')) return;
			const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
			if (!cell) return;
			const row = parseInt(cell.dataset.row ?? '-1');
			const col = parseInt(cell.dataset.col ?? '-1');
			if (row < 1 || col < 0) return;
			evt.preventDefault();
			formulaDragStart = { row, col };
			formulaDragEnd   = { row, col };
			updateFormulaDragHighlight();
			const onFormulaMouseUp = () => {
				if (formulaEdit && formulaDragStart && formulaDragEnd) {
					const label = formulaRangeLabel(formulaDragStart, formulaDragEnd);
					if (label) formulaEdit.insertText(label);
				}
				formulaDragStart = null;
				formulaDragEnd   = null;
				updateFormulaDragHighlight();
				activeDocument.removeEventListener('mouseup', onFormulaMouseUp);
			};
			activeDocument.addEventListener('mouseup', onFormulaMouseUp, { once: true });
			return;
		}
		// Don't interfere when clicking inside an active cell editor —
		// preventDefault would block the browser from placing the cursor
		if ((evt.target as HTMLElement).closest('.bt-editing')) return;
		const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
		if (!cell) return;
		const row = parseInt(cell.dataset.row ?? '-1');
		const col = parseInt(cell.dataset.col ?? '-1');
		if (row < 0 || col < 0) return; // any real cell, header (row 0) included
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

	table.addEventListener('mouseover', (evt: MouseEvent) => {
		if (formulaEdit && formulaDragStart) {
			const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
			if (!cell) return;
			const row = parseInt(cell.dataset.row ?? '-1');
			const col = parseInt(cell.dataset.col ?? '-1');
			if (row < 1 || col < 0) return;
			formulaDragEnd = { row, col };
			updateFormulaDragHighlight();
			return;
		}
		if (!sel.dragging) return;
		const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
		if (!cell) return;
		const row = parseInt(cell.dataset.row ?? '-1');
		const col = parseInt(cell.dataset.col ?? '-1');
		if (row < 0 || col < 0) return;
		if (row !== sel.end?.row || col !== sel.end?.col) {
			sel.end = { row, col };
			sel.hasMoved = true;
			table.dataset.wasDragged = ''; // only set on actual movement, not every click
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
		// A cell being actively edited already gets its own outline (see the
		// selection-highlight CSS) and its editor's own opaque background only
		// covers its OWN content box, not necessarily the full <td> (a `<td>`'s
		// height is "auto" — a plain child's `height:100%` doesn't resolve
		// against a row height some OTHER cell stretched, confirmed by direct
		// measurement) — so tinting it here left a grey band showing around a
		// smaller white patch (reported: editing a cell while still hovering it
		// showed a grey cell with a white rectangle inside). Matches Excel too:
		// a cell mid-edit doesn't also show a hover tint.
		if (el.hasClass('bt-editing')) return;
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

	// Click outside the table clears selection and panel. ctrlCol counts as
	// part of the table's own UI (same as the panel itself) — it sits outside
	// .bt-table-wrapper in the DOM, so without this a click on one of its own
	// buttons (e.g. select-all, below) would bubble here and immediately
	// clear the very selection/panel that button just opened.
	component.registerDomEvent(activeDocument, 'click', (evt: MouseEvent) => {
		if (!selectionPanel && !sel.start) return;
		if (!(evt.target as HTMLElement).closest('.bt-table-wrapper, .bt-cell-panel, .bt-ctrl-col')) {
			removeSelectionPanel();
			clearSel();
		}
	});

	// ── Keyboard cell navigation, Selected state (see cellNav.ts) ────────────
	// Registered on the document, but gated on this table having exactly one
	// Selected cell — so a table the user hasn't clicked into never swallows a
	// keystroke meant for the note, and a multi-cell drag range (same
	// `.bt-selected` class) is left to the mouse-driven selection panel.
	// Ctrl/Cmd+V reads the system clipboard and pastes starting at the current
	// selection's own top-left corner (single Selected cell OR a multi-cell
	// drag range — both share `sel`), reusing the exact same parsing a
	// single-cell edit-mode paste already does (renderEditMode.ts) — an HTML
	// <table> (Excel/Sheets, or a copy made via the selection panel's own
	// "Copy to Excel" button) takes priority, including reconstructing any
	// merges its rowspan/colspan implies (parseHtmlTableWithMerges), falling
	// back to a Markdown pipe table in plain text. Reported as pressing it
	// while cells were merely selected (not being individually edited) doing
	// nothing at all.
	const pasteAtSelection = async (r1: number, c1: number): Promise<void> => {
		if (!onStructuralOp) return;
		let html = '', text = '';
		try {
			const items = await activeWindow.navigator.clipboard.read();
			for (const item of items) {
				if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
				if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
			}
		} catch {
			new Notice(t('pasteFailed'));
			return;
		}
		const parsed = /<table[\s>]/i.test(html) ? parseHtmlTableWithMerges(html) : null;
		const values = parsed?.values ?? parseMarkdownPipeTable(text);
		if (!values) return;
		const anchorColId = colId(model, c1);
		if (!anchorColId) return;
		// A selection anchored on the header row has no "data row" to paste
		// into — the same table-format-conversion op a header cell's own
		// edit-mode paste already uses (renderCell.ts's onPasteGridHeader),
		// values-only: a merge landing in the row that BECOMES the header has
		// no well-defined shape once that row stops being a data row at all.
		if (r1 === 0) {
			void onStructuralOp({ type: 'paste-values-with-header', anchorColId, values });
			return;
		}
		const anchorRowId = rowId(model, r1);
		if (!anchorRowId) return;
		void onStructuralOp({ type: 'paste-values', anchorRowId, anchorColId, values, merges: parsed?.merges });
	};

	component.registerDomEvent(activeDocument, 'keydown', (evt: KeyboardEvent) => {
		if (!sel.start || !sel.end) return;
		if (!table.isConnected) return;

		// An open editor owns these keys itself (renderEditMode.ts) — including
		// its own native copy/paste of whatever text is selected inside it.
		// What identifies that case is where the event CAME FROM — not whether
		// the table currently carries `.bt-editing`, which is mutable state
		// that has already changed by the time this listener runs: a microtask
		// checkpoint happens after every event-listener callback returns, so
		// the editor's own handler has not only run but its deferred commit has
		// too — dropping `.bt-editing` and setting the selection — before this
		// same keystroke finishes bubbling here. Reading the class would
		// therefore see "not editing", treat the Enter the editor just consumed
		// as a fresh command, and reopen the editor it just closed. (Same
		// family as the isConnected-inside-blur trap in CLAUDE.md: don't judge
		// an in-flight event by state that a microtask may already have
		// rewritten.)
		const target = evt.target as HTMLElement | null;
		if (target?.closest('.bt-cell-editor, .bt-date-input, .bt-inline-editor')) return;

		// Paste applies to BOTH a single Selected cell and a multi-cell drag
		// range — everything else below this block is single-cell-only (see
		// the row/col-equality check right after it). Copy is deliberately
		// NOT bound to Ctrl/Cmd+C here — with the multi-cell selection panel
		// open (the common case for copying a range), something ahead of this
		// listener in the real app (outside this plugin's own DOM — Obsidian's
		// own Live Preview/CodeMirror editor the block sits inside is the
		// likely source) already consumes it, so this would be dead code
		// pretending to work. The panel's own "Copy to Excel"/"Copy as
		// Markdown" buttons are the one reliable way to copy a range; Ctrl+V
		// here is what makes pasting it back in feel keyboard-driven end-to-end.
		if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && evt.key.toLowerCase() === 'v' && onStructuralOp) {
			const rect = effectiveSelRect();
			if (rect) {
				evt.preventDefault();
				void pasteAtSelection(rect.r1, rect.c1);
			}
			return;
		}

		if (sel.start.row !== sel.end.row || sel.start.col !== sel.end.col) return;
		const current = sel.start;

		// A choice column's value menu renders to document.body, outside `table` —
		// so there's no cell class to find it by (renderHoverPin.ts tracks it
		// instead). Tab closes it without picking a value and carries on, matching
		// what Tab does out of a text or date editor; everything else is left to
		// Obsidian's own Menu, which already handles ↑/↓ and Enter/Escape.
		const activeMenu = getActiveCellMenu();
		if (activeMenu && activeMenu.row === current.row && activeMenu.col === current.col) {
			if (evt.key === 'Tab') {
				evt.preventDefault();
				activeMenu.close();
				selectCell(moveCell(model, occupied, current, evt.shiftKey ? 'left' : 'right'));
			}
			return;
		}

		if (evt.key === 'Tab') {
			evt.preventDefault();
			selectCell(moveCell(model, occupied, current, evt.shiftKey ? 'left' : 'right'));
			return;
		}
		if (evt.key === 'ArrowUp')    { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'up'));    return; }
		if (evt.key === 'ArrowDown')  { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'down'));  return; }
		if (evt.key === 'ArrowLeft')  { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'left'));  return; }
		if (evt.key === 'ArrowRight') { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'right')); return; }

		// Clear the cell in place, without opening an editor — spreadsheet standard.
		if (evt.key === 'Backspace' || evt.key === 'Delete') {
			evt.preventDefault();
			if (!onCellChange) return;
			const currentValue = current.row === 0
				? (model.columns[current.col]?.name ?? '')
				: resolveCellValue(model, rowId(model, current.row), colId(model, current.col));
			if (currentValue !== '') onCellChange(current.row, current.col, '');
			return;
		}

		// Enter opens the editor keeping the current content; any printable
		// character opens it seeded with just that character (i.e. replacing the
		// content, as Excel/Sheets do). Modifier combos are left to Obsidian.
		if (evt.key === 'Enter' || (evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey)) {
			const cellEl = table.querySelector<HTMLElement>(`[data-row="${current.row}"][data-col="${current.col}"]`);
			if (!cellEl) return;
			evt.preventDefault();
			triggerPrimaryAction(cellEl, evt.key === 'Enter' ? undefined : evt.key);
		}
	});

	// Shared drag-over state — declared here so the drag-and-drop block and the
	// selector-strip block can both read/write the same indicator state.
	let dragOverRow = -1;
	let dragOverCol = -1;
	let dragOverAgg: AggType | null = null;
	const clearDropIndicators = () => {
		[...ownRows(thead), ...ownRows(tbody)].forEach(e => e.removeClass('bt-drop-before'));
		ownCells(table).forEach(e => e.removeClass('bt-col-drop-before'));
	};

	// Formula-mode reference insertion — set while some cell's editor is in
	// formula mode (renderEditMode.ts's FormulaEditHooks), cleared on exit.
	// A separate drag-range pair (not `sel`) tracks a click-drag purely for
	// "which cells to turn into a reference label", independent of the
	// normal multi-cell selection this table already has.
	let formulaEdit: { insertText: (label: string) => void } | null = null;
	let formulaDragStart: { row: number; col: number } | null = null;
	let formulaDragEnd:   { row: number; col: number } | null = null;

	const formulaRangeLabel = (start: { row: number; col: number }, end: { row: number; col: number }): string | null => {
		const startRowId = rowId(model, start.row), startColId = colId(model, start.col);
		const endRowId   = rowId(model, end.row),   endColId   = colId(model, end.col);
		if (!startRowId || !startColId || !endRowId || !endColId) return null;
		if (start.row === end.row && start.col === end.col) return cellIdsToLabel(model, startRowId, startColId);
		return rangeIdsToLabel(model, startRowId, startColId, endRowId, endColId);
	};

	/** Same `.bt-selected` visual language as the ordinary drag-select (`sel`/
	 *  `updateHighlights` above) — reused here rather than a new class so a
	 *  formula-mode range drag looks exactly like any other cell selection the
	 *  user already recognizes. Reported: dragging to build a range reference
	 *  showed no highlight at all, so it wasn't obvious anything was selected
	 *  even though the eventual reference insertion worked correctly. `sel`
	 *  itself is deliberately untouched — formula mode bypasses it entirely
	 *  (see the mousedown branch above), so this toggles the same class from
	 *  its own independent start/end pair instead. */
	const updateFormulaDragHighlight = () => {
		ownCells(table).forEach(e => {
			const row = parseInt(e.dataset.row ?? '-1');
			const col = parseInt(e.dataset.col ?? '-1');
			const inRange = !!formulaDragStart && !!formulaDragEnd &&
				row >= Math.min(formulaDragStart.row, formulaDragEnd.row) &&
				row <= Math.max(formulaDragStart.row, formulaDragEnd.row) &&
				col >= Math.min(formulaDragStart.col, formulaDragEnd.col) &&
				col <= Math.max(formulaDragStart.col, formulaDragEnd.col);
			e.toggleClass('bt-selected', inRange);
		});
	};

	// ── Drag-and-drop row/column reordering ──────────────────────────────────
	if (onStructuralOp) {
		// Row reordering: drop on a row's <tr>, wherever it's physically
		// parented — attached to `table`, not `tbody`, since a row a header
		// merge reaches into is hosted in <thead> (see computeHeaderRowSpan).
		table.addEventListener('dragover', (evt: DragEvent) => {
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

		table.addEventListener('drop', (evt: DragEvent) => {
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
			ownCells(table).filter(e => e.dataset.col === String(colIdx)).forEach(e => e.addClass('bt-col-drop-before'));
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
			// A row a header-anchored merge reaches into is hosted in thead
			// instead — everything about it (model data, sort/filter/formula
			// eligibility, event handling below) stays completely normal; only
			// its DOM parent changes, so rowspan never has to cross into tbody.
			const tr = displayIdx < headerRowSpan ? thead.createEl('tr') : tbody.createEl('tr');
			await renderRow({
				tr, rowIdx: displayIdx, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader: false,
				onCellChange, onColTypeChange, onStructuralOp, onMergeOp, cacheKey, getSingleClickEdit, onEditNavigate,
				onEnterFormulaMode: (insertText) => { formulaEdit = { insertText }; },
				onExitFormulaMode: () => { formulaEdit = null; formulaDragStart = null; formulaDragEnd = null; updateFormulaDragHighlight(); },
			});
			di++;
		}
		renderAggregateRows(tbody, model);
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

	// Inside wrapper (before addRowBtn, see renderFooter's own comment) — NOT
	// container's default, which would land the footer below wrapper's entire
	// box, horizontal scrollbar included.
	renderFooter(wrapper);

	// ── Status bar (FR-017) ───────────────────────────────────────────────────
	// A sibling of `root` under `shell`, NOT a child of root — the status bar
	// sits below the scrollable region, not inside it (Excel's own status bar
	// isn't part of the scrolling grid either), and, since it hosts the zoom
	// control, must not itself be inside the zoomed subtree (see shell's own
	// doc comment above for why). Left section (sheet tabs, wired up once a
	// workbook exists — see tableBlock.ts) and stats share the space left of
	// the divider; the divider and the custom scrollbar's track/thumb (wired
	// up once native scroll hiding + sync land) are pure skeleton for now.
	//
	// Absent/'pinned' (the default — see model.ts) keeps it a real in-flow
	// flex child, permanently occupying its own row height, same as it looks
	// right now. 'hover' switches it to a position:absolute overlay below the
	// visible table area (bt-status-mode-hover, positioned by
	// positionStatusBar below) that only shows via the same bt-strip-visible
	// opacity toggle every other hover-only strip already uses — deliberately
	// NOT a height:0↔22px toggle on the in-flow version, which would repeat
	// the exact scroll-jump/document-height-collapse class of bug the
	// "Re-render flicker" / hover-strip sections elsewhere in this file were
	// hard-won fixes for (see CLAUDE.md) — toggling any real layout size on
	// hover is the thing that caused those, not toggling opacity.
	const statusBarPinned = forceStatusBarPinned || model.statusBarMode !== 'hover';
	const statusBar        = shell.createDiv({ cls: 'bt-status-bar' + (statusBarPinned ? '' : ' bt-status-mode-hover') });
	// The height-resize handle belongs to the status bar's own bottom edge now
	// (Task 8), not root's — a no-op when the table is locked (no
	// onStructuralOp), leaving only the read-only stats behind, same as every
	// other edit-only handle's existing lock behaviour.
	mountHeightResizeHandle(statusBar);
	const statusTabs       = statusBar.createDiv({ cls: 'bt-status-tabs' });
	const statusStats      = statusBar.createDiv({ cls: 'bt-status-stats' });
	// Static separator (no drag, unlike statusDivider below) — visually sets
	// the zoom widget apart from the row/col stats to its left, matching the
	// same vertical-line language statusDivider already uses one section over.
	statusBar.createDiv({ cls: 'bt-status-sep', attr: { 'aria-hidden': 'true' } });
	// Live-drag preview touches the real `zoom` CSS property on `root`
	// (applyZoom) AND the closure-local `zoom` NUMBER above, in the same tick —
	// every ResizeObserver-driven geometry pass in this file (rebuild()'s
	// auto-column-width pin, applyFreeze) can fire mid-drag, well before the
	// eventual commit's full re-render, and must divide by the CURRENT factor,
	// not the one this closure was built with. Leaving the number stale here
	// was the exact bug this comment used to describe as an accepted
	// tradeoff — confirmed via diagnostic logging to actually corrupt a pinned
	// column width (squeeze it into a visible, self-correcting wrap) rather
	// than just "lag a little", so it isn't a tradeoff worth keeping.
	// While the zoom slider is mid-drag, updateOuterFrame skips writing
	// statusBar's own real width — see that function's own comment for why
	// (writing a real layout property on the element the native <input
	// type=range> lives inside, every zoom-driven tick, corrupted the
	// slider's own drag math). sliderDragging is the flag it checks.
	let sliderDragging = false;
	renderZoomControl(statusBar, () => model.zoom ?? 100, onStructuralOp, (percent) => { applyZoom(root, percent); zoom = zoomFactor(percent); }, (dragging) => {
		sliderDragging = dragging;
		// Writes skipped during the drag (see updateOuterFrame's own comment)
		// need one flush once it's safe again, or statusBar's own width stays
		// stale at whatever it was when the drag started.
		if (!dragging) updateOuterFrame();
	});
	const statusDivider    = statusBar.createDiv({ cls: 'bt-status-divider', attr: { 'aria-hidden': 'true' } });
	const statusScroll     = statusBar.createDiv({ cls: 'bt-status-scroll' });
	if (model.statusBarScrollWidth) statusScroll.setCssProps({ '--bt-status-scroll-w': `${model.statusBarScrollWidth}px` });
	const statusScrollTrack = statusScroll.createDiv({ cls: 'bt-status-scroll-track' });
	const statusScrollThumb = statusScrollTrack.createDiv({ cls: 'bt-status-scroll-thumb' });
	// statusTabs: renderTable() never populates this itself — a workbook's
	// sheet tabs are workbook-level chrome owned by tableBlock.ts, which mounts
	// renderSheetTabBar() into this exact element (found via querySelector,
	// see tableBlock.ts's own comment) once this render finishes, when there
	// are 2+ sheets and the active sheet is in table view (Task 9). A
	// single-sheet workbook, or a kanban/calendar active view, leaves it
	// permanently empty — .bt-status-stats' flex layout doesn't shift either
	// way since the div itself is always present.
	void statusTabs;

	updateStatusBarStats = () => {
		const selection = sel.start && sel.end
			? { r1: sel.start.row, r2: sel.end.row, c1: sel.start.col, c2: sel.end.col }
			: null;
		const stats = computeSelectionStats(model, selection);
		statusStats.setText(statusBarStatsLabel(stats));
		// Lets a user's own CSS snippet target/hide one state independently of
		// the other (e.g. "always hide the resting row/col count, keep the
		// selection sum") — both states used to share this one class with
		// nothing but text content to tell them apart, which CSS can't select
		// on at all (reported: github.com/SdKay/obsidian-rich-table/issues/7).
		statusStats.toggleClass('is-selection', stats.selectedRows !== undefined);
	};
	updateStatusBarStats();

	// Custom scrollbar synced to wrapper's real scrollLeft/scrollWidth/
	// clientWidth — the native track/thumb are hidden (see .bt-table-wrapper's
	// own ::-webkit-scrollbar:horizontal rule), but the underlying scroll
	// mechanism (wheel/trackpad/keyboard) is untouched; this is a pure
	// read-and-mirror layer on top of it, not a replacement for it.
	const syncScrollThumb = () => {
		const trackWidth = statusScrollTrack.clientWidth;
		const { scrollWidth, clientWidth, scrollLeft } = wrapper;
		// Nothing to scroll — a native scrollbar disappears entirely here, but
		// this control staying in flow while visually empty read as broken
		// ("看起来像什么都没有") rather than "intentionally nothing to do" — so
		// instead it fills the whole track, the same "100% visible, nothing more
		// to scroll" affordance a full progress bar gives.
		if (scrollWidth <= clientWidth + 1) {
			statusScroll.addClass('bt-status-scroll-empty');
			statusScrollThumb.setCssProps({ '--bt-status-thumb-w': `${trackWidth}px`, '--bt-status-thumb-l': '0px' });
			return;
		}
		statusScroll.removeClass('bt-status-scroll-empty');
		const thumbWidth = Math.max(16, trackWidth * clientWidth / scrollWidth);
		const maxThumbLeft = trackWidth - thumbWidth;
		const thumbLeft = maxThumbLeft * scrollLeft / (scrollWidth - clientWidth);
		statusScrollThumb.setCssProps({
			'--bt-status-thumb-w': `${thumbWidth}px`,
			'--bt-status-thumb-l': `${thumbLeft}px`,
		});
	};
	syncScrollThumb();

	let scrollThumbSyncScheduled = false;
	const scheduleSyncScrollThumb = () => {
		if (scrollThumbSyncScheduled) return;
		scrollThumbSyncScheduled = true;
		window.requestAnimationFrame(() => { scrollThumbSyncScheduled = false; syncScrollThumb(); });
	};
	wrapper.addEventListener('scroll', scheduleSyncScrollThumb);
	// Content width (columns resized/added) and track width (window/pane
	// resized, or the divider — Task 7 — moved) both invalidate the mapping.
	const scrollThumbResizeObs = new ResizeObserver(scheduleSyncScrollThumb);
	scrollThumbResizeObs.observe(table);
	scrollThumbResizeObs.observe(statusScrollTrack);
	component?.register(() => scrollThumbResizeObs.disconnect());

	// Dragging the thumb sets wrapper.scrollLeft directly — this is pure local
	// UI state (like scroll position itself), never written back to the model.
	statusScrollThumb.addEventListener('pointerdown', (e: PointerEvent) => {
		e.preventDefault();
		statusScrollThumb.setPointerCapture(e.pointerId);
		const trackRect = statusScrollTrack.getBoundingClientRect();
		const thumbWidth = statusScrollThumb.getBoundingClientRect().width;
		const startThumbLeft = statusScrollThumb.getBoundingClientRect().left - trackRect.left;
		const startX = e.clientX;
		const maxThumbLeft = trackRect.width - thumbWidth;
		const onMove = (ev: PointerEvent) => {
			const rawLeft = startThumbLeft + (ev.clientX - startX);
			const clampedLeft = Math.max(0, Math.min(maxThumbLeft, rawLeft));
			const scrollRange = wrapper.scrollWidth - wrapper.clientWidth;
			wrapper.scrollLeft = maxThumbLeft > 0 ? scrollRange * clampedLeft / maxThumbLeft : 0;
		};
		const onUp = () => {
			statusScrollThumb.removeEventListener('pointermove', onMove);
			statusScrollThumb.removeEventListener('pointerup', onUp);
		};
		statusScrollThumb.addEventListener('pointermove', onMove);
		statusScrollThumb.addEventListener('pointerup', onUp);
	});

	// Dragging the divider reallocates space between .bt-status-tabs/-stats and
	// .bt-status-scroll, same "drag only touches CSS, release commits the op"
	// split as the view-resize handles above — statusBarScrollWidth persists to
	// the model, current drag position doesn't. Gated on onStructuralOp (no
	// point letting a locked/read-only table write it back) like every other
	// handle that ends in an op dispatch.
	if (onStructuralOp) {
		const MIN_SCROLL_W = 60;
		statusDivider.addEventListener('pointerdown', (e: PointerEvent) => {
			e.preventDefault();
			statusDivider.setPointerCapture(e.pointerId);
			// barRect is visual (getBoundingClientRect); MIN_SCROLL_W/80 are logical
			// design constants and --bt-status-scroll-w is consumed as a logical
			// flex-basis width — divide the visual reads by zoom before mixing them
			// with those, same correction shape as scrollContentOffset's own
			// (NO_ZOOM's doc comment).
			const barRect = statusBar.getBoundingClientRect();
			const barRight = barRect.right / zoom;
			const maxScrollW = Math.max(MIN_SCROLL_W, barRect.width / zoom - 80);
			let newW = statusScroll.getBoundingClientRect().width / zoom;
			const onMove = (ev: PointerEvent) => {
				newW = Math.max(MIN_SCROLL_W, Math.min(maxScrollW, barRight - ev.clientX / zoom));
				statusScroll.setCssProps({ '--bt-status-scroll-w': `${Math.round(newW)}px` });
				scheduleSyncScrollThumb();
			};
			const onUp = () => {
				statusDivider.removeEventListener('pointermove', onMove);
				statusDivider.removeEventListener('pointerup', onUp);
				void onStructuralOp({ type: 'set-status-bar-scroll-width', width: Math.round(newW) });
			};
			statusDivider.addEventListener('pointermove', onMove);
			statusDivider.addEventListener('pointerup', onUp);
		});
	}

	// Hover-mode positioning/show-hide — a no-op pair when pinned (the bar is
	// already in-flow and always visible, nothing to compute or toggle).
	let positionStatusBar = () => { /* pinned: nothing to do */ };
	let showStatusBar     = () => { /* pinned: nothing to do */ };
	let hideStatusBar     = () => { /* pinned: nothing to do */ };
	if (!statusBarPinned) {
		// Reported ("状态栏hover显示，外边框不能自动调整将其包围... hover之后底部外
		// 边框消失了，像是被什么遮挡了"): Obsidian wraps every rendered code block
		// in a container with `contain: paint` + `overflow: hidden`, sized to the
		// block's own normal-FLOW content box (see gridSizePicker.ts's own doc
		// comment for the exact mechanism, confirmed via live diagnostics) — a
		// hover-mode bar anchored BELOW root's own box (the original design: grew
		// the outer frame downward to follow it) is `position: absolute` and
		// contributes nothing to that flow box, so the real container clips it
		// (and the frame's own extension, and the height-resize handle inside it)
		// entirely invisible the instant it tried to show. No CSS fix exists from
		// inside that container (paint containment clips descendants
		// unconditionally) — reproduced directly in a test harness that adds the
		// same `contain: paint; overflow: hidden` wrapper Obsidian's own DOM has,
		// which this plugin's test suite otherwise never exercises.
		//
		// Fixed by never growing past root's own box at all: an overlay flush with
		// the TABLE's own visible bottom edge, covering its last visible row
		// instead of sitting below it — the same HUD-over-content placement
		// obsidian-rich-view's own bottom-edge status/apply bar uses (the
		// original reference for this table's whole outer-frame feature).
		// Anchored to the TABLE's own visible bottom (clipped to the wrapper)
		// MINUS this bar's own height — not root's own bottom edge: root's box
		// also includes the wrapper's reserved space for the
		// normal-flow .bt-edge-add-row "+" button below the table, so anchoring
		// to root's bottom instead would overlay THAT button rather than the
		// table's last row (confirmed via direct measurement — root's own
		// height already includes that reserved strip).
		//
		// Left/width still clip to the visible table area exactly as before
		// (unaffected by this change) — only the vertical anchor moved.
		//
		// Deliberately NOT g.vl/g.vw/g.vt/g.vh (all /zoom-corrected) — those
		// answer "an offset inside the ZOOMED root", for consumers that live
		// inside it (selector strips, ctrl column). statusBar itself lives in
		// `shell`, which is never zoomed (see renderZoom.ts's own reasoning)
		// and whose --sb-* custom properties are consumed there — so these
		// need RAW visual px, with no zoom division, same as `shell`'s own
		// rect would give directly. Dividing by zoom here double-corrected a
		// distance that was already in the right space, invisible only at
		// zoom=100% (where dividing by 1 is a no-op) and confirmed broken at
		// any other zoom — reproduced directly at 50%: the bar landed well
		// past the table's real (zoomed-down) bottom edge instead of hugging
		// it. visBottom is computed from the same raw `g.tr`/`g.wr` rects
		// visLeft/visRight already use below, for the same reason.
		positionStatusBar = () => {
			const g = computeVisibleGeom();
			if (g.tr.width === 0) return;
			const visLeft = Math.max(g.tr.left, g.wr.left);
			const visRight = Math.min(g.tr.right, g.wr.right);
			const visBottom = Math.min(g.tr.bottom, g.wr.bottom);
			const barHeight = statusBar.getBoundingClientRect().height || 28;
			statusBar.setCssProps({
				'--sb-top':   `${visBottom - g.rr.top - barHeight}px`,
				'--sb-left':  `${visLeft - g.rr.left}px`,
				'--sb-width': `${Math.max(0, visRight - visLeft)}px`,
			});
		};
		// No updateOuterFrame() call needed here — a hover-mode bar overlays
		// root's own box rather than extending past it (see positionStatusBar's
		// own comment), so showing/hiding it never changes the frame's geometry.
		showStatusBar = () => { positionStatusBar(); statusBar.addClass('bt-strip-visible'); };
		hideStatusBar = () => { statusBar.removeClass('bt-strip-visible'); };
		window.requestAnimationFrame(positionStatusBar);
		new ResizeObserver(positionStatusBar).observe(table);
	}

	// The outer frame element's real geometry — a `shell`-relative box
	// (--of-l/-t/-w/-h) that always covers `root`'s own box, extended down to
	// also cover a PINNED status bar's box (permanently in normal flow, so
	// shell's own bounding rect — read via getBoundingClientRect() —
	// already includes it: display:block stacks a later sibling below an
	// earlier one automatically). A HOVER-mode bar no longer needs this
	// special-casing at all — it now overlays root's own last row instead of
	// growing past root's box (see positionStatusBar's own comment for why:
	// anything extending past root's flow-box gets clipped by Obsidian's real
	// code-block container, invisibly), so root's own rect already covers it
	// in every mode.
	//
	// Horizontally, the frame tracks the WRAPPER's own box, not root's, once a
	// manual viewWidth is actually narrower than what's available — replacing
	// the earlier corner-bracket markers (--vf-l/-t/-r/-b, .bt-view-corner),
	// which existed only because the frame itself didn't yet track the real
	// width; with the frame doing that natively, a second marker for the same
	// fact was redundant ("重复宣布同一件事，去掉角标，让外框直接体现实际宽度").
	// Same "only when actually narrower" condition those markers used (a
	// manual width could already be clamped back up to fill the same space by
	// max-width:100%, in which case there's no narrower box to show) — but,
	// unlike them, not gated on !model.locked: this is now the frame's own
	// permanent shape, not a dismissable editing cue, so it stays accurate
	// regardless of lock state.
	updateOuterFrame = () => {
		const rr = root.getBoundingClientRect();
		if (rr.width === 0) return;
		const shellRect = shell.getBoundingClientRect();
		const wr = wrapper.getBoundingClientRect();
		// `wrapper.hasClass('bt-view-fixed-w')`, not `typeof model.viewWidth ===
		// 'number'` — the drag-resize handle below sets the CLASS live, on every
		// pointermove, but only writes viewWidth back to the MODEL on release
		// (see its own onUp). Reading the model here meant the frame only
		// started narrowing on the drag AFTER the first one, once a render
		// with the new model.viewWidth had actually happened — reported as
		// "首次拖动调整宽度的时候，外边框没有跟着移动...之后再调整宽度的时候
		// 外边框就跟着移动了". Matches renderGeometry.ts's applyOuterFrame,
		// which already used the class for exactly this reason.
		// Narrows to the wrapper's real box whenever it's genuinely narrower than
		// root — no longer gated on a manual viewWidth, so an auto-width table's
		// frame also hugs the table instead of always spanning the full page
		// (reported: "auto宽度状态下view框宽度还是page宽度").
		const narrower = wr.width < rr.width - 0.5;
		const tableRect = table.getBoundingClientRect();
		// left widens to cover the ctrl column/row selector's worst-case left
		// extent (CTRL_COL_LEFT_GAP, already the exact constant their own
		// --cc-left/--rs-left/--cs-left position math subtracts from wrapper's
		// left edge — see positionCtrlCol/positionSelectors), but only while
		// they could actually be showing — `shell.matches(':hover')` is a
		// cheap style read, not a forced layout, so it's safe to check on
		// every tick unlike the alternative below. A locked table's ctrl
		// column is permanently visible regardless of hover (`.is-locked`'s
		// own CSS) so it always needs the gap. This is a pure arithmetic
		// derivation, not a live getBoundingClientRect() on those elements —
		// an EARLIER version DID measure them live: this function is also a
		// ResizeObserver callback firing on every CSS-zoom tick (the zoom
		// slider sets root.style.zoom on every drag 'input' event), and
		// forcing three extra layout reads on every one of those, while the
		// browser was still mid-reflow, corrupted the *next* pointermove's
		// own hit-testing (reported: the zoom slider itself ran away on a
		// small drag).
		const stripsShowing = (onStructuralOp || onToggleLock) && (root.hasClass('is-locked') || shell.matches(':hover'));
		const leftStripEdge = stripsShowing ? wr.left - CTRL_COL_LEFT_GAP : wr.left;
		const left = narrower ? leftStripEdge : rr.left;
		// `right` is THE one answer to "where is the view's real right edge" —
		// the width handle, the status bar's own box, and the frame border
		// all read this SAME value below, rather than each re-deriving their
		// own version of "narrower ? wrapper's edge : root's edge". They used
		// to: the handle tracked <table>'s own edge (to exclude addColBtn's
		// reserved slot), and the status bar tracked wr.right directly — both
		// silently assumed wrapper's right edge is always wherever <table>
		// ends, which broke the instant something ELSE inside wrapper (a
		// footer wider than the table, see .bt-table-footer) pushed wr.right
		// past that point: the handle stranded itself to the left of
		// addColBtn, and the status bar (gated on manual-width mode only)
		// never moved at all (reported: "列宽把手没有贴着view右边界...它跑到列
		// 增加按钮左侧...状态栏也没有移动到view框内，穿出去了"). wr.right is
		// wrapper's own real box regardless of WHAT inside it is currently
		// widest, so building everything off it directly is both simpler and
		// correct for any future "something new can widen wrapper" case, not
		// just the ones already known about.
		let right = narrower ? wr.right : rr.right;
		// The status bar's own left is wr.left (NOT `left` above) even while
		// the frame's own left widened to cover the hover-only ctrl column/row
		// selector — the bar has nothing to its own left that needs covering,
		// and sharing that widened edge shifted the bar's own layout (and
		// everything inside it, e.g. the zoom slider) sideways purely from
		// hover/unhover, the same "table drifts sideways" class of bug this
		// file works hard to avoid elsewhere.
		//
		// sliderDragging: while the zoom slider (a native <input type=range>
		// living inside statusBar) is mid-drag, skip re-deriving statusBar's
		// own real width altogether — writing that real layout property on
		// every zoom-driven tick fought with the slider's own native drag math
		// (reported: the slider itself ran away on a small drag).
		// renderZoomControl's own onSliderDragChange callback calls this
		// function once more right after the drag ends, to flush whatever was
		// skipped meanwhile.
		if (statusBarPinned && !sliderDragging) {
			const sbLeft = narrower ? wr.left : rr.left;
			let sbRight = right;
			// The bar's own content (sheet tabs, stats, zoom widget) has a real
			// minimum width that can exceed a narrow table's — its children
			// don't reposition on overflow, they just spill past the bar
			// (reported: clicking a sheet tab hit .bt-status-stats instead).
			// bt-measure-natural on BOTH the bar (width: max-content) and
			// statusTabs (opts its own flex-grow child out of "fill the
			// remaining space") together, not just the tabs alone — measuring
			// only the tabs first tried reusing the bar's CURRENT (already
			// narrowed) width as "the rest of the bar's width", but every
			// OTHER fixed-size sibling (stats/zoom/scroll) was just as clipped
			// by that same narrowing, so their current widths were already
			// wrong inputs to build a natural-width estimate from (reported:
			// sheet tabs and .bt-status-stats visibly overlapping — the bar
			// had narrowed below its fixed-size children's own combined
			// width, not just the tabs'). Measuring the whole bar's
			// scrollWidth with both constraints lifted at once sidesteps that
			// — nothing is being squeezed at measurement time, so every
			// child (grow or fixed) reports its own true size.
			if (narrower) {
				statusBar.addClass('bt-measure-natural');
				statusTabs.addClass('bt-measure-natural');
				const barNaturalWidth = statusBar.scrollWidth;
				statusBar.removeClass('bt-measure-natural');
				statusTabs.removeClass('bt-measure-natural');
				sbRight = Math.min(rr.right, Math.max(sbRight, sbLeft + barNaturalWidth));
				// The visible frame must stay at least as wide as the bar
				// sitting inside it, or the bar's own now-wider box would
				// visibly poke out past the frame's right border.
				right = Math.max(right, sbRight);
			}
			statusBar.setCssProps({
				'--sb-pinned-l': `${sbLeft - shellRect.left}px`,
				'--sb-pinned-w': `${sbRight - sbLeft}px`,
			});
		}
		const bottom = statusBarPinned ? shellRect.bottom : rr.bottom;
		// outerFrame lives in `shell`, which — like the status bar itself — is
		// never zoomed (see `shell`'s own doc comment above), so these stay RAW
		// visual px with no `/ zoom` correction, same treatment as --sb-* just
		// above (that comment has the full reasoning for why dividing here
		// would double-correct an already-correctly-scaled distance).
		outerFrame.setCssProps({
			'--of-l': `${left - shellRect.left}px`,
			'--of-t': `${rr.top - shellRect.top}px`,
			'--of-w': `${right - left}px`,
			'--of-h': `${bottom - rr.top}px`,
		});
		// Center the title over <table>'s own box, not the wider box
		// text-align:center actually centers it in: an editable table's
		// contentRow permanently reserves addColBtn's width alongside
		// <table> (flex-shrink:0, occupying its layout box even while
		// invisible — see .bt-edge-add-col's own comment), and wrapper's
		// max-content sizing follows that WHOLE row — so the title (centered
		// in root, which spans that same width) landed visibly right of the
		// table it names, by half of addColBtn's width. Locked tables have
		// no addColBtn and were never off (reported: only on editable
		// tables). Measured, not derived from padding math: reset any prior
		// adjustment first so this frame's measurement reads the title's
		// true unadjusted (text-align:center) position, matching this
		// file's own "measure geometry, don't recompute it analytically"
		// approach elsewhere (e.g. reserveLeftPad's read-then-write).
		const titleEl = root.querySelector<HTMLElement>(':scope > .bt-table-title');
		if (titleEl) {
			titleEl.setCssProps({ '--bt-title-center-adj': '0px' });
			const naturalRect = titleEl.getBoundingClientRect();
			const naturalCenter = naturalRect.left + naturalRect.width / 2;
			const tableCenter = tableRect.left + tableRect.width / 2;
			titleEl.setCssProps({ '--bt-title-center-adj': `${(tableCenter - naturalCenter) / zoom}px` });
		}
		// The width handle (bt-view-resize-r/-br, both root-relative `right: 0`
		// by default) gets the same treatment the height handle already has
		// for free: mountHeightResizeHandle puts bt-view-resize-b INSIDE
		// statusBar, so once statusBar's own box narrows (just above) that
		// handle rides along with it automatically. bt-view-resize-r has no
		// such built-in symmetry — it's root's own direct child — so its right
		// offset is set explicitly here, reading the SAME `right` the frame
		// and status bar just settled on, keeping all three glued to one
		// consistent edge ("调整宽度的把手和调整高度的把手应该是一致的行为").
		// Unlike --of-*/--sb-pinned-* (both `shell`-relative, and shell is
		// never zoomed — see its own doc comment), `.bt-view-resize-r` lives
		// INSIDE root's zoomed subtree, so this needs the same `/ zoom`
		// correction as every other root-relative distance in this file
		// (NO_ZOOM's own doc comment) — (rr.right - right) is a difference of
		// two VISUAL rects.
		root.setCssProps({ '--of-r-gap': `${(rr.right - right) / zoom}px` });
	};
	window.requestAnimationFrame(updateOuterFrame);

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
	reapplyFreezeNow = () => {
		clearHover();
		lastHoverCell = null;
		applyFreeze(table, thead, tbody, model, zoom);
	};

	let freezeApplyScheduled = false;
	const freezeResizeObs = new ResizeObserver(() => {
		if (freezeApplyScheduled) return;
		freezeApplyScheduled = true;
		window.requestAnimationFrame(() => {
			freezeApplyScheduled = false;
			reapplyFreezeNow();
		});
	});
	freezeResizeObs.observe(table);
	// Also watch wrapper: applyFreeze's sticky offsets depend on whether an
	// axis actually scrolls (wrapper vs table size), which a manual
	// viewWidth/viewHeight drag can flip without table itself ever resizing —
	// reported as a frozen column staying at its pre-drag position (never
	// re-measured) while narrowing the view past the point scroll engages.
	freezeResizeObs.observe(wrapper);
	component?.register(() => freezeResizeObs.disconnect());

	// Mark root to activate the padding-reservation + resting-state clip-path
	// CSS that every left/top/right strip (row/col selectors, edge-add "+"
	// buttons, AND the ctrl column) depends on — see .bt-render-root.bt-has-
	// strips in styles.css. Gated on `onStructuralOp || onToggleLock`, not
	// onStructuralOp alone: the ctrl column exists and needs this too whenever
	// onToggleLock is present, independent of whether the (onStructuralOp-only)
	// row/col selectors and edge-add strips also exist — a locked table has the
	// former but not the latter. Without this class, reserveLeftPad's own
	// --bt-sel-pad-left has no rule consuming it at all (confirmed: the custom
	// property was set correctly but padding-left computed to 0 regardless),
	// which was the second half of the wide-locked-table unlock-button bug —
	// reserving the padding alone wasn't enough.
	if (onStructuralOp || onToggleLock) root.addClass('bt-has-strips');

	// ── Edge-hover add strips (CSS Grid cells inside bt-render-root) ──
	if (onStructuralOp) {
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

		isEdgeStripsVisible = () => addRowBtn.hasClass('bt-strip-visible') || addColBtn.hasClass('bt-strip-visible');

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
			addColBtn.setCssProps({ '--strip-height': `${g.vh}px` });
			// addRowBtn needs no JS position math either (sticky handles bottom/
			// left/right — see its own CSS comment), but its --strip-max-width
			// does: caps it to contentRow's (table + addColBtn) rendered width so
			// it matches the table instead of always stretching to the full
			// visible viewport — a no-op for a table that itself needs the full
			// viewport (wide table, horizontal scroll), since the cap then
			// exceeds what left:0/right:0 would render anyway.
			addRowBtn.setCssProps({ '--strip-max-width': `${contentRow.getBoundingClientRect().width / zoom}px` });
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
		repositionEdgeStrips = (geom) => { positionEdgeStrips(geom); };

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
		// strips explicitly against the new visible region. Wired below, alongside the
		// selector strips and ctrl column, into ONE shared bindScrollSync call — see
		// its own comment for why these three used to each run an independent listener.
	}

	// ── Control column: open-external-file · detach-from-xlsx · lock · autofit · theme · aggregate · collapse · views · add-sheet · snapshot — left of the row-drag strip ──
	// All buttons share a vertical flex column positioned just left of the
	// row selector. All but lock need onStructuralOp; lock needs onToggleLock;
	// open-external-file/detach-from-xlsx need onOpenExternalFile/
	// onDetachFromXlsx — see those params' own doc comments for why they're
	// fully separate gates from the other two. ctrlCol itself is now
	// unconditional — snapshotting a table doesn't depend on any of the
	// above being true, so with only those four gates this column would
	// still (rarely) be entirely absent, e.g. a locked table viewed in
	// Reading View with editing off (onStructuralOp AND onToggleLock both
	// undefined there) — exactly the case that should still offer a snapshot.
	{
		const ctrlCol = root.createDiv({ cls: 'bt-ctrl-col' + (model.locked ? ' is-locked' : '') });
		// See hiddenCtrlColButtons' own doc comment — a display-only filter
		// layered on top of every button's existing callback-presence gate,
		// never a substitute for it.
		const shown = (id: CtrlColButtonId): boolean => !hiddenCtrlColButtons?.has(id);

		// Open-in-default-app button — first in column, ahead of lock: for an
		// xlsx-backed table this is the one action that matters more than
		// anything else here (everything else in this column is about editing
		// THIS view, which an xlsx-backed table never offers at all). Not
		// gated on model.collapsed — collapsing hides the rendered body, but
		// has nothing to do with the underlying file this button opens.
		if (onOpenExternalFile && shown('openExternal')) {
			const openBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('openInDefaultApp'), 'data-tooltip-position': 'right' },
			});
			setIcon(openBtn, 'external-link');
			openBtn.addEventListener('click', () => onOpenExternalFile());
		}

		// Convert-to-plain-table button — second, right after open-in-default-
		// app: the other xlsx-only action, so the two sit together ahead of
		// everything else. Same "not gated on collapsed" reasoning as above.
		if (onDetachFromXlsx && shown('detachXlsx')) {
			const detachBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('detachFromXlsx'), 'data-tooltip-position': 'right' },
			});
			setIcon(detachBtn, 'unlink');
			detachBtn.addEventListener('click', () => onDetachFromXlsx());
		}

		// Lock button — hidden while collapsed: only the expand
		// button is shown, since the other buttons act on the now-invisible body.
		if (onToggleLock && !model.collapsed && shown('lock')) {
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
		if (onStructuralOp && !model.collapsed && shown('autoFit')) {
			const autoFitBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('autoFitAll'), 'data-tooltip-position': 'right' },
			});
			setIcon(autoFitBtn, 'maximize-2');
			autoFitBtn.addEventListener('click', () => {
				// Clears every visible column's own width rather than computing and
				// writing a specific number — same reasoning as the per-column
				// dblclick handler (renderResize.ts): an auto column tracks its own
				// content on every render from here on (applyAutoColWidths, called
				// post-render from tableBlock.ts), not just at the moment of this click.
				for (const { colIdx } of visibleCols) {
					const col = model.columns[colIdx];
					if (!col) continue;
					void onStructuralOp({ type: 'set-col-width', colId: col.id, width: 0 });
				}
				for (const row of model.rows) {
					void onStructuralOp({ type: 'set-row-height', rowId: row.id, height: 0 });
				}
			});
			repositionAutoFitBtn = () => { /* positioning handled by ctrlCol */ };
		}

		// Transpose button — swaps rows and columns wholesale (see
		// transposeModel, operations.ts). Column type/formulas/sort/views can't
		// carry across a transpose (no row-shaped equivalent, or keyed to an old
		// column identity that stops existing) — a one-shot structural rewrite
		// same as every other button here, not a reversible "view", so an
		// unwanted transpose is undone the same way any other structural op is
		// (Obsidian's own file history), not a second click. Hidden while
		// collapsed (see lock button above).
		if (onStructuralOp && !model.collapsed && shown('transpose')) {
			const transposeBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('transposeTable'), 'data-tooltip-position': 'right' },
			});
			setIcon(transposeBtn, 'flip-horizontal-2');
			transposeBtn.addEventListener('click', () => void onStructuralOp({ type: 'transpose' }));
		}

		// Select-all button — selects every cell (header included) and opens the
		// same range-selection popup a manual drag-select across the whole table
		// would, so every range-level action (merge/hide/delete rows or columns,
		// align, style, copy) is reachable without dragging corner-to-corner by
		// hand. Hidden while collapsed (see lock button above).
		if (onStructuralOp && !model.collapsed && shown('selectAll')) {
			const selectAllBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('selectAllOpenMenu'), 'data-tooltip-position': 'right' },
			});
			setIcon(selectAllBtn, 'table');
			selectAllBtn.addEventListener('click', () => {
				sel.start = { row: 0, col: 0 };
				sel.end   = { row: model.rows.length, col: model.columns.length - 1 };
				updateHighlights();
				showSelectionPanel();
			});
		}

		// Theme picker button — third in column. Hidden while collapsed (see lock button above).
		if (onStructuralOp && !model.collapsed && shown('theme')) {
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
		if (onStructuralOp && !model.collapsed && shown('aggregate')) {
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
		if (onStructuralOp && shown('collapse')) {
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
		if (onStructuralOp && !model.collapsed && shown('viewSettings')) {
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
				// Hidden entirely (not just disabled) on a 2+-sheet workbook — the
				// bar is forced pinned there regardless of this setting (see
				// forceStatusBarPinned's own doc comment on renderTable), so toggling
				// it would have no visible effect and would just confuse the user
				// about why nothing changed.
				if (!forceStatusBarPinned) {
					menu.addItem(i => i.setTitle(t('pinStatusBar')).setIcon('panel-bottom-dashed')
						.setChecked(model.statusBarMode !== 'hover')
						.onClick(() => void onStructuralOp({
							type: 'set-status-bar-mode',
							mode: model.statusBarMode !== 'hover' ? 'hover' : null,
						})));
				}
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
		if (onStructuralOp && shown('views')) {
			const viewsBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('views'), 'data-tooltip-position': 'right' },
			});
			setIcon(viewsBtn, 'layout-grid');
			viewsBtn.addEventListener('click', (evt: MouseEvent) =>
				showMenuPinned(buildViewSwitcherMenu(model, registry, onStructuralOp), evt));
		}

		// Add sheet — converts this table into a multi-sheet workbook (or, once
		// it already is one, appends another sheet). Absent once the table
		// already has its own bottom sheet-tab-bar (that bar's own "+" takes
		// over — see tableBlock.ts).
		if (onCreateSheet && shown('newSheet')) {
			const addSheetBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('newSheet'), 'data-tooltip-position': 'right' },
			});
			setIcon(addSheetBtn, 'copy-plus');
			addSheetBtn.addEventListener('click', () => onCreateSheet());
		}

		// Snapshot button — last in the column, deliberately: unlike
		// everything above it, it applies to every table regardless of edit/
		// lock/xlsx state, so it reads as a step apart from the editing-
		// focused tools above rather than competing with them for the most
		// prominent (top) spot.
		if (onSnapshot && shown('snapshot')) {
			const snapshotBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('snapshotButton'), 'data-tooltip-position': 'right' },
			});
			setIcon(snapshotBtn, 'camera');
			snapshotBtn.addEventListener('click', (evt: MouseEvent) => {
				const menu = new Menu();
				menu.addItem(i => i.setTitle(t('snapshotCopyPng')).setIcon('copy').onClick(() => onSnapshot('copy-png')));
				menu.addItem(i => i.setTitle(t('snapshotSavePng')).setIcon('image').onClick(() => onSnapshot('save-png')));
				menu.addItem(i => i.setTitle(t('snapshotSaveSvg')).setIcon('file-code').onClick(() => onSnapshot('save-svg')));
				showMenuPinned(menu, evt);
			});
		}

		// Export-to-xlsx button — right next to Snapshot, same "applies
		// regardless of edit/lock state" reasoning; only ever present for a
		// native (non xlsx-backed) table, see onExportXlsx's own doc comment.
		if (onExportXlsx && shown('exportXlsx')) {
			const exportBtn = ctrlCol.createDiv({
				cls: 'bt-ctrl-btn',
				attr: { 'aria-label': t('exportToXlsx'), 'data-tooltip-position': 'right' },
			});
			setIcon(exportBtn, 'folder-up');
			exportBtn.addEventListener('click', () => onExportXlsx());
		}

		// Position the column just left of the row selector (or, on a locked table
		// with no row selector at all, just left of the table itself — see
		// CTRL_COL_LEFT_GAP above) — anchored to the VISIBLE left edge (not the
		// table's own left) so it stays on-screen when a wide table is
		// horizontally scrolled.
		// See positionEdgeStrips' own comment on the optional `geom` parameter —
		// same shared-frame purpose, via bindScrollSync below.
		const positionCtrlCol = (geom: VisibleGeom = computeVisibleGeom()) => {
			const g = geom;
			if (g.tr.width === 0) return;
			// ctrlCol stacks a growing number of buttons (lock/auto-fit/theme/
			// aggregate/collapse/views/add-sheet) with no height cap of its own —
			// for a short table (few rows) that stack is taller than the table
			// itself, so it silently overflows past root's bottom edge and gets
			// clipped by Obsidian's own live-preview widget container (outside
			// this stylesheet's control) instead of just spilling visibly onto
			// the page below. Cap it to the table's own height so it scrolls
			// internally in that case rather than losing buttons off the bottom.
			// Position (--cc-top) clamps to the VISIBLE band (vt), not the full
			// table (tt), so the toolbar stays pinned in view when the table
			// scrolls vertically inside the wrapper instead of scrolling off with
			// the table's top. The height cap deliberately does NOT reuse vh for
			// this: vh is the live intersection of the table's and wrapper's
			// rects, which is scroll-position-INVARIANT everywhere except a
			// narrow band right at the very top/bottom of the scroll range (where
			// the table's own edge is entering the wrapper's visible band) — the
			// icon stack would visibly gain/lose buttons at the bottom as vh
			// dipped there, even though the wrapper's own available height never
			// actually changed (reported: icon spacing/visibility shifting while
			// dragging the scrollbar). The wrapper's clientHeight is exactly as
			// stable as vh everywhere else but doesn't have that dip, since it's
			// the wrapper's own box size, not an intersection with the table's
			// scroll-shifting rect.
			ctrlCol.setCssProps({
				'--cc-top':  `${g.vt + 2}px`,
				'--cc-left': `${g.vl - CTRL_COL_LEFT_GAP}px`,
				'--cc-maxh': `${Math.max(Math.min(g.th, wrapper.clientHeight) - 4, 0)}px`,
			});
		};
		// A locked table's ctrl column is visible from the very first paint
		// (.is-locked's permanent opacity:1 in styles.css — no hover needed), so
		// unlike the general case it can't wait for a first mouseenter to reserve
		// the left padding it needs on a wide table (see reserveLeftPad's own doc
		// comment): with no room reserved yet, the initial positionCtrlCol() below
		// would still compute an off-screen --cc-left. Locked-but-unhovered is
		// exactly the state the reported bug was stuck in.
		if (model.locked) reserveLeftPad();
		// Called with no args here — each of these hands positionCtrlCol its OWN
		// callback argument (a timestamp, an Event, a ResizeObserverEntry[]), none
		// of which is the VisibleGeom its now-optional parameter expects; omitting
		// the arg lets that parameter's default (a fresh computeVisibleGeom())
		// take over, exactly as before this parameter existed.
		window.requestAnimationFrame(() => positionCtrlCol());
		table.addEventListener('bt-layout-changed', () => positionCtrlCol());
		new ResizeObserver(() => positionCtrlCol()).observe(table);
		// A wide table shifted right by --bt-sel-pad-left on hover doesn't change the
		// table's own size (it just overflows less/more), so ResizeObserver won't fire
		// — the mouseenter handler calls this explicitly after prepareLayout instead.
		repositionCtrlCol = positionCtrlCol;
	}

	// ── Row / column selector strips (Excel-style whole-row/column selection) ──
	if (onStructuralOp) {
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
		model.columns.forEach((c, ci) => {
			if (c.hidden) return;
			const h = colTrack.createDiv({ cls: 'bt-sel-resize-col', attr: { 'aria-hidden': 'true' } });
			setupColResize(h, table, ci, getRegistry, model, onStructuralOp, component, zoom);
			colResizeHandles.set(ci, h);
		});
		const rowResizeHandles = new Map<number, HTMLElement>();
		// ri is 0-based v2 index; display index = ri+1 (header is 0)
		model.rows.forEach((row, ri) => {
			const displayIdx = ri + 1;
			const h = rowTrack.createDiv({ cls: 'bt-sel-resize-row', attr: { 'aria-hidden': 'true' } });
			bindResizeHandle(
				h, table, `data-row="${displayIdx}"`, '--bt-row-height', 24,
				(height) => void onStructuralOp({ type: 'set-row-height', rowId: row.id, height }),
				component,
				undefined,
				zoom,
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
					...ownRows(thead),
					...ownRows(tbody),
				];
				for (const tr of rows) {
					for (const cell of Array.from(tr.querySelectorAll<HTMLTableCellElement>('[data-col]'))) {
						const ci = cell.dataset.col;
						if (ci === undefined) continue;
						if (cell.colSpan > 1) {
							spanned.push({ startCol: parseInt(ci), span: cell.colSpan, width: cell.getBoundingClientRect().width / zoom });
							continue;
						}
						if (measured.has(ci)) continue;
						measured.set(ci, cell.getBoundingClientRect().width / zoom);
					}
				}
				for (const { startCol, span, width } of spanned) {
					const share = width / span;
					for (let ci = startCol; ci < startCol + span; ci++) {
						const key = String(ci);
						if (!measured.has(key)) measured.set(key, share);
					}
				}
				let pinnedTotal = 0;
				for (const c of ownCols(table)) {
					const ci = c.dataset.col;
					if (ci === undefined) continue;
					const w = measured.get(ci);
					if (w !== undefined) { c.style.setProperty('width', `${w}px`); pinnedTotal += w; }
				}
				// Also pin the TABLE's own width to the just-measured total — table-
				// layout stays 'auto' (unlike the hasExplicitWidths branch above,
				// which switches to 'fixed'), so a column whose content genuinely
				// grows can still expand past this on a later pass; this only
				// removes AMBIGUITY about the table's width when content does NOT
				// need more room. Leaving the table with no explicit width at all
				// left auto-layout free to treat "how much width does the table
				// get" as open-ended, which .bt-table-content-row's own
				// width:max-content (sized from the table's contribution) could
				// then read as bigger than the just-measured columns actually
				// needed — and since the readout gets pinned right back onto the
				// <col>s next cycle, this became a self-feeding ratchet: every
				// hover (showSelectors -> rebuild()) measured a table a few px
				// wider than last time and pinned that as the new floor, repeating
				// indefinitely (reported: the whole table growing wider and wider
				// across repeated hovers until it filled the page — and the column
				// selector's own width, computed from the table's PRE-rebuild size
				// earlier in the same hover, one step behind the growth). An
				// explicit width removes that ambiguity: auto-layout still expands
				// a column past it if content truly needs more (its own defined
				// behavior for real overflow), but stops manufacturing UNNEEDED
				// extra space just because a flex ancestor's max-content query
				// left the door open.
				if (pinnedTotal > 0) table.style.setProperty('width', `${pinnedTotal}px`);
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
			for (const c of ownCols(table)) {
				const w = parseFloat(c.style.width) || 0;
				if (c.dataset.col !== undefined) {
					// Visible column — one cell per physical column
					const ci = parseInt(c.dataset.col);
					// Frozen cell/grip parents directly under colSel, outside colTrack
					// (see styles.css's .bt-sel-track comment) — see selectorAxisOffset
					// for which coordinate space --cl needs as a result.
					const frozen = freezeCols !== undefined && ci < freezeCols;
					const colX = selectorAxisOffset(c, 'x', zoom, frozen);
					const cell = (frozen ? colSel : colTrack).createDiv({ cls: 'bt-sel-cell' });
					cell.dataset.idx = String(ci);
					cell.setText(colIndexToLetter(ci));
					cell.setCssProps({ '--cl': `${colX}px`, '--cw': `${w}px` });
					if (frozen) cell.addClass('bt-sel-cell-frozen');
					if (selAxis === 'col') {
						const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
						if (ci >= lo && ci <= hi) cell.addClass('is-sel');
					}
					// Drag grip: sibling of sel-cell, lives in the upper 10px of the
					// col selector (above the A/B/C labels) — separate from selection zone.
					const colGrip = (frozen ? colSel : colTrack).createDiv({
						cls: 'bt-sel-col-drag' + (frozen ? ' bt-sel-cell-frozen' : ''),
						attr: { draggable: 'true', 'aria-label': t('dragReorderCol') },
					});
					setIcon(colGrip, 'grip-vertical');
					// colX is already zoom-corrected (selectorAxisOffset above); w is
					// from style.width (already logical) — no further correction needed.
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
			}

			// Row selector — cells positioned by --rt/--rh relative to the selector's
			// own top edge, which CSS Grid aligns with the table wrapper automatically.
			rowSel.querySelectorAll('.bt-sel-cell, .bt-sel-row-drag').forEach(e => e.remove());
			const allTrs = [
				...ownRows(thead),
				...ownRows(tbody),
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
				// Both operands are visual (getBoundingClientRect); rowTop/rowH feed
				// --rt/--rh below, consumed as logical top/height — divide the
				// difference/size by zoom, same correction shape as
				// scrollContentOffset's own (NO_ZOOM's doc comment).
				const rowTop = (trRect.top - tableTop) / zoom;
				const rowH   = trRect.height / zoom;
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
					// Aggregate rows aren't part of model.rows/freezeRows — never frozen,
					// always in the track.
					const cell = rowTrack.createDiv({ cls: 'bt-sel-cell bt-sel-agg-cell' });
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
					const grip = rowTrack.createDiv({
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
					// A frozen row's real cell doesn't move on vertical inner-scroll
					// (position:sticky) — its row-number label shouldn't either. In
					// renderFreeze idx<=freezeRows are frozen (header=0 + first
					// freezeRows data rows); ri here is that same data-row value.
					// Parenting outside rowTrack (see styles.css's .bt-sel-track
					// comment) is what stops it tracking scroll now.
					const rowFrozen = freezeRows !== undefined && ri <= freezeRows;
					const cell = (rowFrozen ? rowSel : rowTrack).createDiv({ cls: 'bt-sel-cell' });
					cell.dataset.idx = String(ri);
					cell.setText(String(ri + 1));
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
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
						const grip = (rowFrozen ? rowSel : rowTrack).createDiv({
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
			for (const c of ownCols(table)) {
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
				h.setCssProps({ '--rx': `${selectorAxisOffset(c, 'x', zoom, colFrozen) + (parseFloat(c.style.width) || 0)}px` });
				h.toggleClass('bt-sel-cell-frozen', colFrozen);
				const colDesiredParent = colFrozen ? colSel : colTrack;
				if (h.parentElement !== colDesiredParent) colDesiredParent.appendChild(h);
			}
			for (const [ri, h] of rowResizeHandles) {
				// data-row is 1-based (header=0, data rows=1,2,3…); ri is 0-based model index.
				const firstCell = table.querySelector<HTMLElement>(`[data-row="${ri + 1}"]`);
				const tr = firstCell?.closest<HTMLElement>('tr');
				if (tr) {
					const rowResizeFrozen = freezeRows !== undefined && ri + 1 <= freezeRows;
					// Row's BOTTOM edge — vertical mirror of the column seams above.
					h.setCssProps({ '--ry': `${selectorAxisOffset(tr, 'y', zoom, rowResizeFrozen) + tr.getBoundingClientRect().height / zoom}px` });
					h.toggleClass('bt-sel-cell-frozen', rowResizeFrozen);
					const rowDesiredParent = rowResizeFrozen ? rowSel : rowTrack;
					if (h.parentElement !== rowDesiredParent) rowDesiredParent.appendChild(h);
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
				'--cs-top':   `${g.vt - SEL_TOTAL}px`,
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
				'--rs-left':   `${g.vl - SEL_TOTAL}px`,
				'--rs-top':    `${g.vt}px`,
				'--rs-height': `${g.vh}px`,
			});
			rowTrack.style.setProperty('transform', `translateY(${g.rowOffset}px)`);
		};
		repositionSelectorStrips = (geom) => { positionSelectors(geom); };

		// prepareLayout / restoreLayout are called by the proximity handler BEFORE
		// show/hide so that positionEdgeStrips() and positionSelectors() both see
		// the same layout (table already shifted by --bt-sel-pad).
		prepareLayout = () => {
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
			// Cancel whatever --bt-title-mb-pull the active theme set (bridged onto titleEl in
			// tableBlock.ts) so the title sits flush above the col-selector strip on hover
			// instead of stacking a second gap on top of the theme's own pull-closer value.
			const pull = titleEl ? parseFloat(getComputedStyle(titleEl).getPropertyValue('--bt-title-mb-pull')) || 0 : 0;
			titleEl?.setCssProps({ '--bt-title-mb-adj': `${-pull}px` });
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
			updateOuterFrame();
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
			repositionLockBtn();
			repositionAutoFitBtn();
			updateOuterFrame(); // mirror of prepareLayout's own call — see its comment
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
				{ divider: true },
				// Whole-column default — covers every row in the column, including
				// ones added later (applyColStyle/resolveStylesV2's fallback), unlike
				// the header cell's own align (renderCell.ts) or a data cell/range's
				// own align, which only override this default for their own scope.
				buildAlignCellOp(model.columns[lo]?.align, (align) => {
					for (let ci = lo; ci <= hi; ci++) {
						const id = colId(model, ci);
						if (id) void onStructuralOp({ type: 'set-col-align', colId: id, align });
					}
				}),
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
				ownCells(table).filter(e => e.dataset.col === String(toIdx)).forEach(e => e.addClass('bt-col-drop-before'));
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
				// table, not tbody: the target row may be one a header merge
				// reaches into, hosted in <thead> (see computeHeaderRowSpan).
				ownCells(table).find(e => e.dataset.row === String(toIdx))?.closest<HTMLElement>('tr')?.addClass('bt-drop-before');
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
				ownRows(tbody).find(tr => tr.dataset.agg === toAgg)?.addClass('bt-drop-before');
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
			() => colSel.hasClass('bt-strip-visible') || rowSel.hasClass('bt-strip-visible') || isEdgeStripsVisible(),
			[positionSelectors, repositionCtrlCol, repositionEdgeStrips],
			zoom,
		);
	}

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
	// Gated on `onStructuralOp || onToggleLock`, not `onStructuralOp` alone: the
	// ctrl column (lock/auto-fit/theme icons) stays visible on a LOCKED table via
	// `.is-locked`'s permanent opacity:1 — bypassing the hover-to-reveal path
	// entirely — but its own left-edge positioning still depends on
	// reserveLeftPad/repositionCtrlCol below, which used to run ONLY from this
	// mouseenter handler. A locked table has no onStructuralOp (row/col selectors
	// don't exist then, correctly), so the whole block — and the padding
	// reservation with it — never ran, and a wide locked table's unlock button
	// rendered off-screen with no room reserved for it (reported: permanently
	// hidden top-left unlock button on a wide table once locked; a narrow table's
	// natural margin hid the same underlying gap). showEdgeStrips/showSelectors
	// stay gated on onStructuralOp specifically — those exist to run editing-only
	// actions that a locked table shouldn't offer at all.
	if (onStructuralOp || onToggleLock) {
		shell.addEventListener('mouseenter', () => {
			// Runs unconditionally: needed for the ctrl column's own positioning
			// even when nothing else in this handler applies (locked table).
			reserveLeftPad();
			repositionLockBtn();
			repositionAutoFitBtn();
			repositionCtrlCol();
			// Same content-box-miss reasoning as prepareLayout's own call to this
			// — reserveLeftPad above can grow root's padding-left even on a
			// LOCKED table (no onStructuralOp, so prepareLayout below never
			// runs), which still needs the frame to track that growth.
			updateOuterFrame();
			// Unconditional too (not gated on onStructuralOp) — a hover-mode
			// status bar shows its (read-only) stats on a locked table exactly
			// like the ctrl column's own lock icon does; only the height-resize
			// hotspot inside it (Task 8) needs its own separate onStructuralOp
			// check. A no-op when statusBarMode is pinned (see its own let
			// assignment above) or absent from this block entirely (neither
			// onStructuralOp nor onToggleLock — see that limitation noted where
			// showStatusBar is assigned).
			showStatusBar();
			if (onStructuralOp) {
				// prepareLayout MUST run before any position calculation so all
				// getBoundingClientRect() calls see the final padded layout — it
				// re-does reserveLeftPad (idempotent) plus the top/title-pull
				// reservation the selector strips need that reserveLeftPad alone
				// doesn't cover.
				prepareLayout();
				showEdgeStrips();
				showSelectors();
			}
		});
		// A menu/panel we opened (Menu, cell/filter panel) always renders outside
		// shell's own DOM subtree (appended to document.body), so moving the mouse
		// onto it fires a real mouseleave here. While one is open, defer hiding
		// until it actually closes (onHoverUnpinned below) instead of collapsing
		// the strips out from under the user's cursor and re-showing them the
		// moment the mouse comes back — that jump was the reported bad UX.
		shell.addEventListener('mouseleave', () => {
			if (isHoverPinned()) return;
			hideEdgeStrips(); hideSelectors(); hideStatusBar();
		});
		component?.register(onHoverUnpinned(() => {
			if (!shell.matches(':hover')) { hideEdgeStrips(); hideSelectors(); hideStatusBar(); }
		}));
		if (onStructuralOp) {
			// Reserve the top strip padding from the very first paint, not just
			// from the first hover onward, and never collapse it back (see
			// restoreLayout's own comment) — every table with selector strips,
			// not only one with a sheet-tab-bar below it (that was the original,
			// narrower trigger for this same permanent-reservation treatment; the
			// outer-pane-scrollbar shift is a second, more general one). A locked
			// table has no column selector to reserve room for, so this stays
			// scoped to onStructuralOp specifically, unlike reserveLeftPad above.
			// Sets --bt-sel-pad directly rather than calling the full
			// prepareLayout() — that also computes --bt-sel-pad-left, which gets
			// the same "reserve from first paint, never collapse" treatment now,
			// just from a separate call site (tableBlock.ts's post-swap pass,
			// alongside applyAutoColWidths) rather than here: unlike this flat
			// constant, it needs real geometry (wrapper vs root) that a still-
			// detached tree (this function always runs against one — see
			// tableBlock.ts) can't provide.
			root.setCssProps({ '--bt-sel-pad': `${TOP_STRIP_PAD}px` });
			updateOuterFrame();
		}
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
			// e.clientX/Y and rootRect are both visual; --bt-mx/-my are consumed by
			// theme CSS as logical px (e.g. `left`/`background-position` inside this
			// same zoomed subtree) — same correction shape as scrollContentOffset's
			// own (NO_ZOOM's doc comment).
			root.setCssProps({
				'--bt-mx': `${Math.round((e.clientX - rootRect.left) / zoom)}px`,
				'--bt-my': `${Math.round((e.clientY - rootRect.top ) / zoom)}px`,
			});
		});
		root.addEventListener('mouseleave', () => {
			rootRect = null;
			root.setCssProps({ '--bt-mx': '-9999px', '--bt-my': '-9999px' });
		});
		component?.register(() => { rootRect = null; });
	}
}


