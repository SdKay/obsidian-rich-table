import { App, Component, MarkdownRenderer, Menu, setIcon } from 'obsidian';
import {
	t, isZh, typeLabel,
	hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel,
	collapsedRowsLabel,
} from './i18n';
import { BUILTIN_THEMES } from './themes/index';
import { WikilinkInputSuggest } from './wikilinkInputSuggest';
import type { ColumnDefV2, TableModelV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { StructuralOpV2 } from './operations';
import { colIndexToLetter } from './utils';
import { SEL_TOTAL, AUTOFIT_OFFSET } from './selectorLayout';
import { resolveStylesV2, resolveHeaderStylesV2, parseStyleTarget, matchesHeaderCell, matchesCell, type ResolvedStyleV2 } from './styleTarget';
import type { StyleRuleV2 } from './model';

type OpHandler         = (op: StructuralOpV2) => Promise<void>;
type ToggleLockHandler = () => Promise<void>;

// Internal adapter types — same call-shape as v1 handlers, wired through OpHandler
type CellChangeHandler    = (rowIdx: number, colIdx: number, value: string) => void;
type ColTypeChangeHandler = (colIdx: number, colType: string | undefined) => void;
type StructuralOpHandler  = (op: StructuralOpV2) => void;

// Convenience accessors: convert display index to v2 ID
// di = 1-based data row display index (1 = first data row)
const rowId  = (model: TableModelV2, di: number): string => model.rows[di - 1]?.id ?? '';
const colId  = (model: TableModelV2, ci: number): string => model.columns[ci]?.id ?? '';

// Apply a ResolvedStyleV2 to an element via inline style + CSS classes
function applyResolvedStyle(el: HTMLElement, rs: ResolvedStyleV2): void {
	if (rs.bg)    el.style.setProperty('background-color', rs.bg);
	if (rs.color) el.style.setProperty('color', rs.color);
	if (rs.size) {
		el.style.setProperty('font-size', `${rs.size}px`);
		el.style.setProperty('--bt-cell-font-size', `${rs.size}px`);
	}
	if (rs.bold)   el.addClass('bt-bold');
	if (rs.italic) el.addClass('bt-italic');
}

/** Special column types handled with dedicated editors (not choice dropdowns). */
const SPECIAL_TYPES = new Set(['date']);

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
): Promise<void> {
	if (model.columns.length === 0) return;
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

	const occupied = buildOccupied(model);
	// Root container with position:relative so all overlay elements (selectors,
	// edge-add strips) can use position:absolute and stay naturally inside
	// Obsidian's content pane — no viewport coordinate math needed.
	const themeClass = model.theme ? `bt-render-root bt-theme-${model.theme}` : 'bt-render-root';
	const root = container.createDiv({ cls: themeClass + (model.collapsed ? ' bt-collapsed' : '') });
	onRootReady?.(root);

	const wrapper = root.createDiv({ cls: 'bt-table-wrapper' });
	const table = wrapper.createEl('table', { cls: 'bt-table' });

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
			],
			onApplyStyle: (bg, color, size, bold, italic) => void onStructuralOp({ type: 'set-range-style', target: rangeTarget, bg, color, size, bold, italic }),
			onClose: () => { clearSel(); selectionPanel = null; },
		});
	};

	// Delegate drag events on tbody so we don't add listeners to every cell
	// (mousedown/mouseover use the cell's data-row/col attributes)

	const thead = table.createEl('thead');
	const headerTr = thead.createEl('tr');
	await renderRow(headerTr, 0, model, occupied, registry, getRegistry, app, sourcePath, component, true, onCellChange, onColTypeChange, onStructuralOp);

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
	const clearDropIndicators = () => {
		table.querySelectorAll<HTMLElement>('.bt-drop-before').forEach(e => e.removeClass('bt-drop-before'));
		table.querySelectorAll<HTMLElement>('.bt-drop-after').forEach(e => e.removeClass('bt-drop-after'));
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
			await renderRow(tr, displayIdx, model, occupied, registry, getRegistry, app, sourcePath, component, false, onCellChange, onColTypeChange, onStructuralOp);
			di++;
		}
	}

	// TODO: filter status bar ("Showing X of Y rows · Clear filter") — deferred until
	// a unified table status bar is designed that can also host sort/aggregate info.

	// Footer — hidden while collapsed, along with the table body.
	if (model.footer && !model.collapsed) {
		// Flatten array and split strings on \n so YAML arrays and \n-strings both work
		const rawLines = Array.isArray(model.footer) ? model.footer : [model.footer];
		const lines = rawLines.flatMap(l => l.split('\n'));
		const footerEl = container.createDiv({ cls: 'bt-table-footer' });
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

	// ── Edge-hover add strips (CSS Grid cells inside bt-render-root) ──
	if (onStructuralOp) {
		// Mark root to activate the CSS Grid layout that hosts the selector and
		// edge-add strips around the table wrapper.
		root.addClass('bt-has-strips');
		const addRowBtn = root.createDiv({ cls: 'bt-edge-add-row' });
		addRowBtn.createSpan({ cls: 'bt-edge-plus', text: '+' });

		const addColBtn = root.createDiv({ cls: 'bt-edge-add-col' });
		addColBtn.createSpan({ cls: 'bt-edge-plus', text: '+' });

		// Belt-and-suspenders: strip nodes are freshly created so they should never
		// carry bt-strip-visible or stale --strip-* inline vars, but reset them
		// explicitly to guard against any future code path that might clone them.
		const resetStrip = (el: HTMLElement) => {
			el.removeClass('bt-strip-visible');
			el.style.removeProperty('--strip-top');
			el.style.removeProperty('--strip-left');
			el.style.removeProperty('--strip-width');
			el.style.removeProperty('--strip-height');
		};
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

			const tr = table.getBoundingClientRect();
			const rr = root.getBoundingClientRect();
			if (tr.width === 0 || tr.height === 0) return false;
			if (rr.width === 0) return false;
			if (rr.height === 0) {
				window.requestAnimationFrame(() => positionEdgeStrips());
				return false;
			}
			// Double-content guard: root height should never exceed table height by more
			// than the maximum padding (sel-pad=32 + add-pad=24 = 56px, so 60px is safe).
			// rr.height >> tr.height means the DOM contains two stacked roots (cache clone
			// injection window), producing the anomalous rr.height≈1113 observed in logs.
			if (rr.height > tr.height + 60) return false;

			const tl = tr.left - rr.left;
			const tt = tr.top  - rr.top;
			if (tt < -5 || tl < -5 || tt > rr.height + 5) return false;
			const tw = tr.width;
			const th = tr.height;
			addRowBtn.setCssProps({
				'--strip-top':   `${tt + th + 2}px`,
				'--strip-left':  `${tl}px`,
				'--strip-width': `${tw}px`,
			});
			addColBtn.setCssProps({
				'--strip-top':    `${tt}px`,
				'--strip-left':   `${tl + tw + 2}px`,
				'--strip-height': `${th}px`,
			});
			// Expose table geometry so themes can compute table-local cursor coordinates.
			// Themes subtract these from --bt-mx/--bt-my to get cursor position within
			// the table's own coordinate space (e.g. for cursor-glow on row hover).
			root.setCssProps({
				'--bt-tbl-l': `${tl}px`,
				'--bt-tbl-t': `${tt}px`,
				'--bt-tbl-w': `${tw}px`,
				'--bt-tbl-h': `${th}px`,
			});
			return true;
		};

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
		const resizeObs = new ResizeObserver(() => {
			if (addRowBtn.hasClass('bt-strip-visible'))
				window.requestAnimationFrame(positionEdgeStrips);
		});
		resizeObs.observe(table);
		component?.register(() => resizeObs.disconnect());
	}

	// ── Control column: autofit · lock · theme — left of the row-drag strip ──
	// All three buttons share a vertical flex column positioned just left of the
	// row selector. Autofit and theme need onStructuralOp; lock needs onToggleLock.
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
				menu.showAtMouseEvent(evt);
			});
		}

		// Collapse/expand button — fourth in column
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

		// Position the column just left of the row selector
		const positionCtrlCol = () => {
			const tr = table.getBoundingClientRect();
			const rr = root.getBoundingClientRect();
			if (tr.width === 0) return;
			ctrlCol.setCssProps({
				'--cc-top':  `${tr.top - rr.top + 2}px`,
				'--cc-left': `${tr.left - rr.left - SEL_TOTAL - AUTOFIT_OFFSET - 4}px`,
			});
		};
		window.requestAnimationFrame(positionCtrlCol);
		table.addEventListener('bt-layout-changed', positionCtrlCol);
		new ResizeObserver(positionCtrlCol).observe(table);
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
				const rows = [
					...Array.from(thead.querySelectorAll<HTMLElement>('tr')),
					...Array.from(tbody.querySelectorAll<HTMLElement>('tr')),
				];
				for (const tr of rows) {
					for (const cell of Array.from(tr.querySelectorAll<HTMLTableCellElement>('[data-col]'))) {
						const ci = cell.dataset.col;
						if (ci === undefined || cell.colSpan > 1 || measured.has(ci)) continue;
						measured.set(ci, cell.getBoundingClientRect().width);
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
			// Pre-index hidden-group indicators from the header by their left-edge x.
			const hiddenGroupByX = new Map<number, string[]>();
			let hiddenColX = 0;
			for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
				const w = parseInt(c.style.width) || 0;
				if (c.dataset.col === undefined) {
					// Find matching bt-col-indicator in thead
					for (const th2 of Array.from(thead.querySelectorAll<HTMLElement>('th.bt-col-indicator[data-hidden-group]'))) {
						if (!hiddenGroupByX.has(Math.round(hiddenColX))) {
							const grp = JSON.parse(th2.dataset.hiddenGroup ?? '[]') as string[];
							hiddenGroupByX.set(Math.round(hiddenColX), grp);
							break;
						}
					}
				}
				hiddenColX += w;
			}

			let colX = 0;
			for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
				const w = parseInt(c.style.width) || 0;
				if (c.dataset.col !== undefined) {
					// Visible column — one cell per physical column
					const ci = parseInt(c.dataset.col);
					const cell = colSel.createDiv({ cls: 'bt-sel-cell' });
					cell.dataset.idx = String(ci);
					cell.setText(colIndexToLetter(ci));
					cell.setCssProps({ '--cl': `${colX}px`, '--cw': `${w}px` });
					if (selAxis === 'col') {
						const lo = Math.min(selI1, selI2), hi = Math.max(selI1, selI2);
						if (ci >= lo && ci <= hi) cell.addClass('is-sel');
					}
					// Drag grip: sibling of sel-cell, lives in the upper 10px of the
					// col selector (above the A/B/C labels) — separate from selection zone.
					const colGrip = colSel.createDiv({
						cls: 'bt-sel-col-drag',
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
				} else {
					// Hidden column group — match by x position
					const group = hiddenGroupByX.get(Math.round(colX)) ?? [];
					const cell = colSel.createDiv({ cls: 'bt-sel-cell bt-sel-hidden' });
					cell.setAttribute('aria-label', `${group.length} hidden column${group.length > 1 ? 's' : ''} — click to show`);
					cell.setAttribute('data-tooltip-position', 'top');
					cell.setCssProps({ '--cl': `${colX}px`, '--cw': `${w}px` });
					if (group.length > 0) {
						const g = group;
						cell.addEventListener('click', () => void onStructuralOp({ type: 'show-col-group', colIds: g }));
					}
				}
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
					const group = JSON.parse(tr.dataset.hiddenGroup ?? '[]') as string[];
					const cell = rowSel.createDiv({ cls: 'bt-sel-cell bt-sel-hidden' });
					cell.setAttribute('aria-label', `${group.length} hidden row${group.length > 1 ? 's' : ''} — click to show`);
					cell.setAttribute('data-tooltip-position', 'right');
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					cell.addEventListener('click', () => void onStructuralOp({ type: 'show-row-group', rowIds: group }));
				} else {
					const firstCell = tr.querySelector<HTMLElement>('[data-row]');
					if (!firstCell) continue;
					const ri = parseInt(firstCell.dataset.row ?? '-1');
					if (ri < 0) continue;
					const cell = rowSel.createDiv({ cls: 'bt-sel-cell' });
					cell.dataset.idx = String(ri);
					cell.setText(String(ri + 1));
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					if (selAxis === 'row') {
						const lo = Math.min(selI1, selI2), hi2 = Math.max(selI1, selI2);
						if (ri >= lo && ri <= hi2) cell.addClass('is-sel');
					}
					// Drag grip: sibling of the sel-cell, lives in the outer 10px of the
					// row selector (left zone), completely separate from the 22px selection
					// zone — no pointer-event conflict with range-selection.
					if (ri > 0) {
						const grip = rowSel.createDiv({
							cls: 'bt-sel-row-drag',
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
			let cx = 0;
			for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
				cx += parseInt(c.style.width) || 0;
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
			const tr = table.getBoundingClientRect();
			const rr = root.getBoundingClientRect();
			const tl = tr.left - rr.left;
			const tt = tr.top  - rr.top;
			colSel.setCssProps({
				'--cs-left':  `${tl}px`,
				'--cs-top':   `${tt - SEL_TOTAL}px`,
				'--cs-width': `${tr.width}px`,
			});
			rowSel.setCssProps({
				'--rs-left':   `${tl - SEL_TOTAL}px`,
				'--rs-top':    `${tt}px`,
				'--rs-height': `${tr.height}px`,
			});
		};

		// prepareLayout / restoreLayout are called by the proximity handler BEFORE
		// show/hide so that positionEdgeStrips() and positionSelectors() both see
		// the same layout (table already shifted by --bt-sel-pad).
		prepareLayout = () => {
			root.setCssProps({ '--bt-sel-pad': `${SEL_TOTAL}px`, '--bt-add-pad': '24px' });
			// Cancel whatever --bt-title-mb-pull the active theme set (bridged onto titleEl in
			// tableBlock.ts) so the title sits flush above the col-selector strip on hover
			// instead of stacking a second gap on top of the theme's own pull-closer value.
			const pull = titleEl ? parseFloat(getComputedStyle(titleEl).getPropertyValue('--bt-title-mb-pull')) || 0 : 0;
			titleEl?.setCssProps({ '--bt-title-mb-adj': `${-pull}px` });
		};
		restoreLayout = () => {
			root.setCssProps({ '--bt-sel-pad': '0px', '--bt-add-pad': '0px' });
			titleEl?.setCssProps({ '--bt-title-mb-adj': '0px' });
			repositionLockBtn();
			repositionAutoFitBtn();
		};

		showSelectors = () => {
			if (selHideTimer) { window.clearTimeout(selHideTimer); selHideTimer = null; }
			positionSelectors();
			rebuild();
			colSel.addClass('bt-strip-visible');
			rowSel.addClass('bt-strip-visible');
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
			const cellOps: CellOpDef[] = axis === 'col' ? [
				{ icon: 'eye-off', label: hideColsLabel(lo, hi, colIndexToLetter),
					action: () => { for (let ci = lo; ci <= hi; ci++) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
				{ icon: 'trash',   label: deleteColsLabel(lo, hi, colIndexToLetter), danger: true,
					action: () => { for (let ci = hi; ci >= lo; ci--) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
			] : lo === 0 && hi === 0 ? [] : [  // no hide/delete for header row
				{ icon: 'eye-off', label: hideRowsLabel(lo, hi),
					action: () => { for (let ri = lo; ri <= hi; ri++) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
				{ icon: 'trash',   label: deleteRowsLabel(lo, hi), danger: true,
					action: () => { for (let ri = hi; ri >= lo; ri--) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
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

		// Column/row resize changes cell geometry → reposition + rebuild selector strips
		table.addEventListener('bt-layout-changed', () => {
			if (colSel.hasClass('bt-strip-visible') || rowSel.hasClass('bt-strip-visible')) {
				positionSelectors();
				rebuild();
			}
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
			showEdgeStrips();
			showSelectors();
		});
		root.addEventListener('mouseleave', () => { hideEdgeStrips(); hideSelectors(); });
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

async function renderRow(
	tr: HTMLTableRowElement,
	rowIdx: number,  // 0 = header, 1+ = data rows (1-based)
	model: TableModelV2,
	occupied: Set<string>,
	registry: ChoiceRegistry,
	getRegistry: () => ChoiceRegistry,
	app: App,
	sourcePath: string,
	component: Component,
	isHeader: boolean,
	onCellChange?: CellChangeHandler,
	onColTypeChange?: ColTypeChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): Promise<void> {
	const currentRow = rowIdx > 0 ? (model.rows[rowIdx - 1] ?? null) : null;
	let c = 0;

	while (c < model.columns.length) {
		const col = model.columns[c];
		if (!col) { c++; continue; }

		// Check occupied set using v2 IDs
		const currentRowId = currentRow?.id ?? '';
		const currentColId = col.id;
		if (occupied.has(`${currentRowId}.${currentColId}`)) { c++; continue; }

		// Hidden column group — render a single narrow indicator cell
		if (col.hidden) {
			const groupIds: string[] = [];
			while (c < model.columns.length && model.columns[c]?.hidden) {
				groupIds.push(model.columns[c]!.id);
				c++;
			}

			const tag       = isHeader ? 'th' : 'td';
			const indicator = tr.createEl(tag, { cls: 'bt-col-indicator' });

			if (isHeader) {
				indicator.createSpan({ cls: 'bt-indicator-arrow', text: '▶' });
				indicator.createSpan({ cls: 'bt-indicator-count', text: `${groupIds.length}` });
				indicator.setAttribute('aria-label',
					`${groupIds.length} hidden column${groupIds.length > 1 ? 's' : ''}. Click to show.`);
				indicator.setAttribute('data-tooltip-position', 'top');
				indicator.dataset.hiddenGroup = JSON.stringify(groupIds); // string IDs for selector strip
				if (onStructuralOp) {
					indicator.addEventListener('click', () =>
						void onStructuralOp({ type: 'show-col-group', colIds: groupIds }));
				}
			}
			continue;
		}

		// Normal cell — snapshot c so closures below capture the right column index
		const colIdx = c;
		const merge = getMergeOrigin(rowIdx, colIdx, model);
		const tag   = isHeader ? 'th' : 'td';
		const el    = tr.createEl(tag, { cls: isHeader ? 'bt-th' : 'bt-td' });
		el.dataset.row = String(rowIdx);
		el.dataset.col = String(colIdx);

		if (merge) {
			// Adjust rowspan/colspan to skip hidden rows/cols within the merge
			let rowSpan = 0;
			for (let ri = merge.startRow; ri <= merge.endRow; ri++) {
				const hidden = ri > 0 ? (model.rows[ri - 1]?.hidden ?? false) : false;
				if (!hidden) rowSpan++;
			}
			let colSpan = 0;
			for (let ci = merge.startCol; ci <= merge.endCol; ci++) {
				if (!model.columns[ci]?.hidden) colSpan++;
			}
			if (rowSpan > 1) el.rowSpan = rowSpan;
			if (colSpan > 1) el.colSpan = colSpan;
		}

		applyColStyle(el, col);
		applyStyleRulesV2(el, rowIdx, colIdx, model);
		// Apply stored row height (height on td acts as minimum row height)
		const rh = currentRow?.height;
		if (rh) el.style.setProperty('--bt-row-height', `${rh}px`);
		else el.style.removeProperty('--bt-row-height');

		// Cell value: header uses col.name; data uses cells record keyed by colId.
		// When this cell is a merge's (possibly hidden-row-promoted) effective anchor,
		// always read from the merge's literal anchor cell — the row being rendered here
		// may just be standing in for a hidden literal anchor and has no data of its own.
		const value = isHeader
			? (col.name ?? '')
			: merge
				? (model.rows.find(r => r.id === merge.anchorRowId)?.cells[merge.anchorColId] ?? '')
				: (currentRow?.cells[col.id] ?? '');

		if (isHeader) {
			renderHeaderCell(el, value, col, colIdx, getRegistry, app, sourcePath, model, component, onCellChange, onColTypeChange, onStructuralOp);
		} else {
			await renderDataCell(el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model, onCellChange, onStructuralOp);
		}
		c++;
	}
}

function renderHeaderCell(
	el: HTMLElement,
	value: string,
	col: ColumnDefV2,
	colIdx: number,
	getRegistry: () => ChoiceRegistry,
	app: App,
	sourcePath: string,
	model: TableModelV2,
	component: Component,
	onCellChange?: CellChangeHandler,
	onColTypeChange?: ColTypeChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): void {
	el.createSpan({ cls: 'bt-th-text', text: value });
	if (col.type) el.addClass('bt-th-typed');

	const openPanel = (evt: MouseEvent, isDblClick = false) => {
		if (!onStructuralOp && !onColTypeChange) return;
		const ops: CellOpDef[] = [];
		if (onStructuralOp) {
			ops.push(
				// Insert first data row: afterRowId = null (insert before all data rows)
				{ icon: 'arrow-down',  label: t('insertRowBelow'),  action: () => void onStructuralOp({ type: 'insert-row', afterRowId: null }) },
				{ icon: 'arrow-left',  label: t('insertColBefore'), action: () => void onStructuralOp({ type: 'insert-col', afterColId: colIdx > 0 ? (model.columns[colIdx - 1]?.id ?? null) : null }) },
				{ icon: 'arrow-right', label: t('insertColAfter'),  action: () => void onStructuralOp({ type: 'insert-col', afterColId: col.id }) },
				{ icon: 'eye-off',     label: t('hideColumn'),      action: () => void onStructuralOp({ type: 'hide-col', colId: col.id }) },
				{ icon: 'trash',       label: t('deleteColumn'), danger: true, action: () => void onStructuralOp({ type: 'delete-col', colId: col.id }) },
			);
			// Alignment only in the double-click panel, not in right-click or selection menus
			if (isDblClick) {
				ops.push(
					{ icon: 'align-left',   label: t('alignLeft'),   action: () => void onStructuralOp({ type: 'set-col-align', colId: col.id, align: 'left' }) },
					{ icon: 'align-center', label: t('alignCenter'), action: () => void onStructuralOp({ type: 'set-col-align', colId: col.id, align: 'center' }) },
					{ icon: 'align-right',  label: t('alignRight'),  action: () => void onStructuralOp({ type: 'set-col-align', colId: col.id, align: 'right' }) },
				);
			}
		}
		openCellPanel({
			component,
			anchor: el,
			els: [el],
			styleTarget: `header.${col.id}`,
			existingStyle: cellEffectiveStyle(model, 0, colIdx),
			inheritedStyle: cellInheritedStyle(model, 0, colIdx),
			showTextColor: true,
			cellOps: ops,
			typeSection: onColTypeChange ? {
				colIdx,
				currentType: col.type,
				getRegistry,
				onColTypeChange,
			} : undefined,
			onApplyStyle: onStructuralOp
				? (bg, color, size, bold, italic) => void onStructuralOp({ type: 'set-range-style', target: `header.${col.id}`, bg, color, size, bold, italic })
				: () => { /* no-op */ },
		});
	};

	el.addEventListener('contextmenu', (evt: MouseEvent) => { evt.preventDefault(); openPanel(evt, false); });
	el.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' || evt.key === ' ') {
			evt.preventDefault();
			const r = el.getBoundingClientRect();
			openPanel(new MouseEvent('click', { clientX: r.left, clientY: r.bottom }));
		}
	});

	if (onCellChange) {
		el.addClass('bt-th-editable');
		let editTimer: number | null = null;
		el.addEventListener('mousedown', (evt: MouseEvent) => {
			if (evt.detail >= 2 && editTimer !== null) { window.clearTimeout(editTimer); editTimer = null; return; }
			// In edit mode: place cursor at the click position using caretRangeFromPoint.
			// Without this the second click has no effect because the th element intercepts it.
			if (el.hasClass('bt-editing')) {
				const editor = el.querySelector<HTMLElement>('.bt-cell-editor');
				if (editor) {
					// caretRangeFromPoint is the Chromium/Electron equivalent of the standard caretPositionFromPoint;
					// cast through unknown (not `as Document & {...}`) so TS doesn't inherit the lib.dom.d.ts @deprecated tag
					const range = (activeDocument as unknown as { caretRangeFromPoint?(x: number, y: number): Range | null })
						.caretRangeFromPoint?.(evt.clientX, evt.clientY);
					if (range) {
						const sel = activeWindow.getSelection();
						sel?.removeAllRanges();
						sel?.addRange(range);
					}
					editor.focus();
					evt.preventDefault(); // prevent the outer element from resetting selection
				}
			}
		});
		el.addEventListener('click', (evt: MouseEvent) => {
			if (el.hasClass('bt-editing')) return;
			if (evt.detail >= 2) return;
			if (editTimer !== null) return;
			editTimer = window.setTimeout(() => { editTimer = null; enterEditMode(el, value, 0, colIdx, app, sourcePath, onCellChange); }, 200);
		});
	}

	el.addEventListener('dblclick', (evt: MouseEvent) => {
		if (el.hasClass('bt-editing')) return;
		openPanel(evt, true);
	});

	// Filter button — bottom-right corner of the header cell
	if (onStructuralOp) {
		const activeValues = model.filter?.[col.id];
		const filterBtn = el.createDiv({
			cls: 'bt-filter-btn' + (activeValues ? ' bt-filter-active' : ''),
			attr: { 'aria-label': t('filterColumn'), 'data-tooltip-position': 'top' },
		});
		setIcon(filterBtn, 'filter');
		filterBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			openFilterPanel(el, colIdx, model, getRegistry(), onStructuralOp, component);
		});
	}
	// Column resize is handled by the selector-strip handles (works with merges too)
}

async function renderDataCell(
	el: HTMLElement,
	value: string,
	col: ColumnDefV2,
	rowIdx: number,
	colIdx: number,
	registry: ChoiceRegistry,
	app: App,
	sourcePath: string,
	component: Component,
	model: TableModelV2,
	onCellChange?: CellChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): Promise<void> {
	const trimmed = value.trim();

	// Special type: date picker
	if (col.type === 'date') {
		renderDateCell(el, trimmed, rowIdx, colIdx, model, component, onCellChange, onStructuralOp);
		return;
	}

	if (col.type) {
		const choiceType = registry.get(col.type);
		const option = choiceType ? registry.getOption(col.type, trimmed) : undefined;

		const pill = el.createSpan({ cls: 'bt-choice' });

		if (option) {
			if (option.color) pill.setCssProps({ '--bt-choice-bg': option.color });
			pill.setText(option.label ?? option.value);
		} else {
			pill.addClass('bt-choice-unknown');
			pill.createSpan({ cls: 'bt-choice-warn-icon', text: '⚠' });
			pill.createSpan({ text: trimmed || '(empty)' });
			pill.setAttribute(
				'aria-label',
				`"${trimmed}" is not a valid option for type "${col.type ?? ''}"`,
			);
			pill.setAttribute('data-tooltip-position', 'top');
		}

		if (onCellChange && choiceType) {
			pill.addClass('bt-choice-interactive');
			pill.setAttribute('role', 'button');
			pill.setAttribute('tabindex', '0');
			if (option) {
				pill.setAttribute('aria-label', t('changeValue'));
				pill.setAttribute('data-tooltip-position', 'top');
			}

			const openMenu = (evt: MouseEvent) => {
				const menu = new Menu();
				for (const opt of choiceType.options) {
					menu.addItem(item => {
						item.setTitle(opt.label ?? opt.value);
						if (opt.value === trimmed) item.setChecked(true);
						item.onClick(() => {
							pill.removeClass('bt-choice-unknown');
							if (opt.color) pill.setCssProps({ '--bt-choice-bg': opt.color });
							pill.setText(opt.label ?? opt.value);
							void onCellChange(rowIdx, colIdx, opt.value);
						});
					});
				}
				menu.showAtMouseEvent(evt);
			};

			// Single click → value menu (100 ms delay to allow double-click detection).
			// mousedown.detail >= 2 fires before click(detail=2) and cancels the timer,
			// keeping the transition to the unified panel clean with no dropdown flash.
			let choiceTimer: number | null = null;
			el.addEventListener('mousedown', (evt: MouseEvent) => {
				if (evt.detail >= 2 && choiceTimer !== null) {
					window.clearTimeout(choiceTimer);
					choiceTimer = null;
				}
			});
			el.addEventListener('click', (evt: MouseEvent) => {
				if (evt.detail >= 2) return;
				if (choiceTimer !== null) return;
				const savedEvt = evt;
				choiceTimer = window.setTimeout(() => { choiceTimer = null; openMenu(savedEvt); }, 100);
			});
			el.addEventListener('keydown', (evt: KeyboardEvent) => {
				if (evt.key === 'Enter' || evt.key === ' ') {
					evt.preventDefault();
					el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				}
			});
		}

		if (onStructuralOp) {
			el.addEventListener('dblclick', (evt: MouseEvent) => {
				const ops = dataCellOps(rowIdx, colIdx, model, onStructuralOp);
				const { sTarget, exactTarget, isMerge, rangeRule, applyStyle } =
					buildCellStyleContext(rowIdx, colIdx, model, onStructuralOp);
				openCellPanel({
					component,
					anchor: el, els: [el],
					styleTarget: sTarget,
					existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
					inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx, exactTarget),
					showTextColor: isMerge || !!rangeRule,
					showBoldItalic: false,
					cellOps: ops,
					onApplyStyle: applyStyle,
				});
			});
		}
		return;
	}

	if (trimmed) {
		await MarkdownRenderer.render(app, trimmed, el, sourcePath, component);
		// A soft line break (a lone \n typed via Shift+Enter, as opposed to a literal
		// <br> the user typed) is rendered by the markdown engine as "<br>\n" — the
		// trailing \n lands as a leading newline on the following text node, which
		// renders as extra vertical space and makes that break look looser than a
		// literal <br>. Strip it so every <br> in the cell — typed or soft-break —
		// has identical spacing.
		el.querySelectorAll('br').forEach(br => {
			const next = br.nextSibling;
			if (next?.nodeType === Node.TEXT_NODE && next.textContent) {
				next.textContent = next.textContent.replace(/^\n+/, '');
			}
		});
		// Convert <ul>/<ol> to <br>-separated inline content — the only reliable way
		// to match <br> line spacing regardless of which theme variables are in use.
		el.querySelectorAll<HTMLElement>('ul, ol').forEach(list => {
			const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
			if (items.length === 0) return;
			const isOrdered = list.tagName === 'OL';
			// Wrap in inline-block so the block centers as a unit while items stay left-aligned.
			// Built inside a detached fragment (not activeDocument itself, which only ever
			// allows one root child) then moved into place below via replaceChild.
			const wrapper = createFragment().createDiv({ cls: 'bt-list-block' });
			items.forEach((item, i) => {
				if (i > 0) wrapper.createEl('br');
				wrapper.createSpan({ cls: 'bt-list-marker', text: isOrdered ? (i + 1) + '. ' : '• ' });
				Array.from(item.childNodes).forEach(n => wrapper.appendChild(n));
			});
			list.parentNode?.replaceChild(wrapper, list);
		});
	}

	if (onCellChange) {
		el.addClass('bt-td-editable');

		// Single click (200 ms delay) — text editor; double click — style panel.
		let editTimer: number | null = null;
		el.addEventListener('mousedown', (evt: MouseEvent) => {
			if (evt.detail >= 2 && editTimer !== null) {
				window.clearTimeout(editTimer);
				editTimer = null;
			}
		});
		el.addEventListener('click', (evt: MouseEvent) => {
			if (el.hasClass('bt-editing')) return;
			if ((evt.target as HTMLElement).closest('.internal-link')) return;
			if ((evt.target as HTMLElement).closest('table')?.dataset.wasDragged !== undefined) return;
			if (evt.detail >= 2) return;
			if (editTimer !== null) return;
			editTimer = window.setTimeout(() => {
				editTimer = null;
				enterEditMode(el, value, rowIdx, colIdx, app, sourcePath, onCellChange);
			}, 200);
		});
	}

	if (onStructuralOp) {
		el.addEventListener('dblclick', () => {
			if (el.hasClass('bt-editing')) return;
			const ops = dataCellOps(rowIdx, colIdx, model, onStructuralOp);
			const { sTarget, exactTarget, applyStyle } =
				buildCellStyleContext(rowIdx, colIdx, model, onStructuralOp);
			openCellPanel({
				component,
				anchor: el, els: [el],
				styleTarget: sTarget,
				existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
				inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx, exactTarget),
				showTextColor: true,
				cellOps: ops,
				onApplyStyle: applyStyle,
			});
		});
	}
}

// ── Date cell ─────────────────────────────────────────────────────────────────

function renderDateCell(
	el: HTMLElement,
	value: string,
	rowIdx: number,
	colIdx: number,
	model: TableModelV2,
	component: Component,
	onCellChange?: CellChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): void {
	if (value) {
		try {
			const [y, m, d] = value.split('-').map(Number);
			const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
			el.createSpan({ text: date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) });
		} catch {
			el.createSpan({ text: value });
		}
	} else {
		el.createSpan({ cls: 'bt-date-empty', text: '—' });
	}

	if (onCellChange) {
		el.addClass('bt-td-editable');

		// Single click (delayed) → date picker; double click → style panel
		let dateTimer: number | null = null;
		el.addEventListener('mousedown', (evt: MouseEvent) => {
			if (evt.detail >= 2 && dateTimer !== null) {
				window.clearTimeout(dateTimer);
				dateTimer = null;
			}
		});
		el.addEventListener('click', (evt: MouseEvent) => {
			if (el.hasClass('bt-editing')) return;
			if ((evt.target as HTMLElement).closest('table')?.dataset.wasDragged !== undefined) return;
			if (evt.detail >= 2) return;
			if (dateTimer !== null) return;
			dateTimer = window.setTimeout(() => {
				dateTimer = null;
				enterDateEditMode(el, value, rowIdx, colIdx, onCellChange);
			}, 200);
		});
	}

	if (onStructuralOp) {
		el.addEventListener('dblclick', () => {
			if (el.hasClass('bt-editing')) return;
			const ops = dataCellOps(rowIdx, colIdx, model, onStructuralOp);
			const { sTarget, exactTarget, applyStyle } =
				buildCellStyleContext(rowIdx, colIdx, model, onStructuralOp);
			openCellPanel({
				component,
				anchor: el, els: [el],
				styleTarget: sTarget,
				existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
				inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx, exactTarget),
				showTextColor: true,
				cellOps: ops,
				onApplyStyle: applyStyle,
			});
		});
	}
}

interface CellOpDef {
	icon:    string;
	label:   string;
	danger?: boolean;
	action:  () => void;
}

interface CellPanelConfig {
	component:       Component;
	anchor:          HTMLElement;
	els:             HTMLElement[];
	styleTarget:     string;
	existingStyle:   { bg?: string; color?: string; size?: number; bold?: boolean; italic?: boolean };
	inheritedStyle?: { bg?: string; color?: string; size?: number; bold?: boolean; italic?: boolean };
	showTextColor:   boolean;
	showBoldItalic?: boolean; // default true; false for typed cells where pill overrides bold/italic
	cellOps:       CellOpDef[];
	typeSection?:  {
		colIdx:          number;
		currentType?:    string;
		getRegistry:     () => ChoiceRegistry;
		onColTypeChange: ColTypeChangeHandler;
	};
	onApplyStyle: (bg: string | null, color: string | null, size: number | null, bold: boolean | null, italic: boolean | null) => void;
	onClose?:     () => void;
}

/** Effective style of a cell, using v2 priority cascade. */
function cellEffectiveStyle(
	model: TableModelV2, rowIdx: number, colIdx: number,
): ResolvedStyleV2 {
	const col = model.columns[colIdx];
	if (!col) return {};
	if (rowIdx === 0) return resolveHeaderStylesV2(model.styles, col.id);
	const row = model.rows[rowIdx - 1];
	if (!row) return {};
	return resolveStylesV2(model.styles, row.id, col.id, model);
}

/**
 * Style a cell inherits when the exact cell/header-cell rule is excluded.
 * Used as the "inherited" preview fallback in the style panel.
 */
function cellInheritedStyle(
	model: TableModelV2, rowIdx: number, colIdx: number,
	exactTarget?: string,
): ResolvedStyleV2 {
	const col = model.columns[colIdx];
	if (!col) return {};
	const defaultExact = rowIdx === 0 ? `header.${col.id}` : (() => {
		const row = model.rows[rowIdx - 1];
		return row ? `${row.id}.${col.id}` : '';
	})();
	const target = exactTarget ?? defaultExact;
	const filtered = model.styles.filter(s => s.target !== target);
	if (rowIdx === 0) return resolveHeaderStylesV2(filtered, col.id);
	const row = model.rows[rowIdx - 1];
	if (!row) return {};
	return resolveStylesV2(filtered, row.id, col.id, model);
}

type ApplyStyleFn = (bg: string | null, color: string | null, size: number | null, bold: boolean | null, italic: boolean | null) => void;

/**
 * Builds the style-panel context for a data cell:
 * - Merge origin  → sTarget is the merge range; Apply uses set-range-style.
 * - Non-merge cell with a range rule (e.g. "D5:D7") → Apply splits the range
 *   to isolate this cell, then sets a cell-specific rule.
 * - Plain cell    → Apply uses set-cell-style directly.
 */
function buildCellStyleContext(
	rowIdx: number, colIdx: number,
	model: TableModelV2,
	onStructuralOp: StructuralOpHandler,
): { sTarget: string; exactTarget: string; isMerge: boolean; rangeRule: StyleRuleV2 | null; applyStyle: ApplyStyleFn } {
	const col = model.columns[colIdx];
	const row = rowIdx > 0 ? model.rows[rowIdx - 1] : null;
	if (!col || (rowIdx > 0 && !row)) {
		return { sTarget: '', exactTarget: '', isMerge: false, rangeRule: null, applyStyle: () => {} };
	}
	const rId = row?.id ?? '';
	const cId = col.id;
	const single = rId ? `${rId}.${cId}` : `header.${cId}`;

	const merge = getMergeOrigin(rowIdx, colIdx, model);
	const sTarget = merge
		? `${merge.anchorRowId}.${merge.anchorColId}:${merge.endRowId}.${merge.endColId}`
		: single;

	const rangeRule = !merge
		? (model.styles.find(s => {
			if (s.target === single) return false;
			const t = parseStyleTarget(s.target);
			if (!t) return false;
			return rId ? matchesCell(t, rId, cId, model) : matchesHeaderCell(t, cId);
		}) ?? null)
		: null;
	const exactTarget = merge ? sTarget : (rangeRule?.target ?? single);

	const applyStyle: ApplyStyleFn = (bg, color, size, bold, italic) => {
		if (merge) {
			void onStructuralOp({ type: 'set-range-style', target: sTarget, bg, color, size, bold, italic });
		} else if (rangeRule) {
			void onStructuralOp({ type: 'split-range-style', rangeTarget: rangeRule.target, excludeRowId: rId, excludeColId: cId });
			void onStructuralOp({ type: 'set-cell-style', rowId: rId, colId: cId, bg, color, size, bold, italic });
		} else {
			void onStructuralOp({ type: 'set-cell-style', rowId: rId, colId: cId, bg, color, size, bold, italic });
		}
	};
	return { sTarget, exactTarget, isMerge: !!merge, rangeRule, applyStyle };
}


/** Standard cell-op buttons for a data cell (row/col insert/delete/hide + optional unmerge). */
function dataCellOps(
	rowIdx: number, colIdx: number,
	model: TableModelV2, onStructuralOp: StructuralOpHandler,
): CellOpDef[] {
	const ops: CellOpDef[] = [];
	const merge = getMergeOrigin(rowIdx, colIdx, model);
	if (merge && (merge.endRow > merge.startRow || merge.endCol > merge.startCol)) {
		ops.push({ icon: 'table-2', label: t('unmergeCells'),
			action: () => void onStructuralOp({ type: 'unmerge-cells', anchorRowId: merge.anchorRowId, anchorColId: merge.anchorColId }) });
	}

	const r1 = merge?.startRow ?? rowIdx;
	const r2 = merge?.endRow   ?? rowIdx;
	const c1 = merge?.startCol ?? colIdx;
	const c2 = merge?.endCol   ?? colIdx;

	// r1 > 0 always (data cells only). afterRowId null = insert before first row.
	const afterAbove = r1 > 1 ? (model.rows[r1 - 2]?.id ?? null) : null;
	const afterBelow = model.rows[r2 - 1]?.id ?? null;
	const afterLeft  = c1 > 0 ? (model.columns[c1 - 1]?.id ?? null) : null;
	const afterRight = model.columns[c2]?.id ?? null;

	ops.push(
		{ icon: 'arrow-up',    label: t('insertRowAbove'),  action: () => void onStructuralOp({ type: 'insert-row', afterRowId: afterAbove }) },
		{ icon: 'arrow-down',  label: t('insertRowBelow'),  action: () => void onStructuralOp({ type: 'insert-row', afterRowId: afterBelow }) },
		{ icon: 'arrow-left',  label: t('insertColBefore'), action: () => void onStructuralOp({ type: 'insert-col', afterColId: afterLeft }) },
		{ icon: 'arrow-right', label: t('insertColAfter'),  action: () => void onStructuralOp({ type: 'insert-col', afterColId: afterRight }) },
		{ icon: 'eye-off', label: hideRowsLabel(r1, r2),
			action: () => { for (let r = r1; r <= r2; r++) { const id = rowId(model, r); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
		{ icon: 'eye-off', label: hideColsLabel(c1, c2, colIndexToLetter),
			action: () => { for (let c = c1; c <= c2; c++) { const id = colId(model, c); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
		{ icon: 'trash', label: deleteRowsLabel(r1, r2), danger: true,
			action: () => { for (let r = r2; r >= r1; r--) { const id = rowId(model, r); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
		{ icon: 'trash', label: deleteColsLabel(c1, c2, colIndexToLetter), danger: true,
			action: () => { for (let c = c2; c >= c1; c--) { const id = colId(model, c); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
	);
	return ops;
}

// Module-level reference so any new openCellPanel call can close the previous one first.
let closeActivePanel: (() => void) | null = null;

/** Filter dropdown panel for a column. */
function openFilterPanel(
	anchor: HTMLElement,
	colIdx: number,
	model: TableModelV2,
	registry: ChoiceRegistry,
	onStructuralOp: StructuralOpHandler,
	component: Component,
): void {
	closeActivePanel?.();

	const col = model.columns[colIdx];
	if (!col) return;

	// Collect candidate values: typed columns use defined options; others use unique data values
	const defined: { value: string; label: string }[] = [];
	if (col.type && !SPECIAL_TYPES.has(col.type)) {
		const ct = registry.get(col.type);
		if (ct) {
			for (const opt of ct.options) defined.push({ value: opt.value, label: opt.label ?? opt.value });
		}
	}
	if (defined.length === 0) {
		// Text column — gather unique non-empty values from data rows
		const seen = new Set<string>();
		for (const row of model.rows) {
			const v = (row.cells[col.id] ?? '').trim();
			if (v && !seen.has(v)) { seen.add(v); defined.push({ value: v, label: v }); }
		}
		defined.sort((a, b) => a.label.localeCompare(b.label));
	}

	const current = new Set(model.filter?.[col.id] ?? []);
	const noFilter = current.size === 0;

	// Position panel
	const ar = anchor.getBoundingClientRect();
	const PW = 220;
	let top  = ar.bottom + 4;
	let left = ar.left;
	if (top  + 320 > activeWindow.innerHeight) top  = Math.max(8, ar.top - 320);
	if (left + PW  > activeWindow.innerWidth)  left = Math.max(8, ar.right - PW);

	const panel = activeDocument.body.createDiv({ cls: 'bt-filter-panel' });
	panel.setCssProps({ '--fp-top': `${top}px`, '--fp-left': `${left}px` });

	// Select all checkbox
	const allRow  = panel.createDiv({ cls: 'bt-fp-row bt-fp-all-row' });
	const allChk  = allRow.createEl('input', { attr: { type: 'checkbox' } });
	allChk.checked = noFilter;
	allRow.createSpan({ text: t('filterSelectAll') });

	panel.createDiv({ cls: 'bt-fp-divider' });

	// Value checkboxes
	const checkboxes: { chk: HTMLInputElement; value: string }[] = [];
	const listEl = panel.createDiv({ cls: 'bt-fp-list' });
	for (const { value, label } of defined) {
		const row = listEl.createDiv({ cls: 'bt-fp-row' });
		const chk = row.createEl('input', { attr: { type: 'checkbox' } });
		chk.checked = noFilter || current.has(value);
		row.createSpan({ text: label });
		checkboxes.push({ chk, value });
		chk.addEventListener('change', () => {
			const anyUnchecked = checkboxes.some(c => !c.chk.checked);
			allChk.checked = !anyUnchecked;
			allChk.indeterminate = anyUnchecked && checkboxes.some(c => c.chk.checked);
		});
	}

	allChk.addEventListener('change', () => {
		for (const { chk } of checkboxes) chk.checked = allChk.checked;
	});
	if (!noFilter) {
		const anyUnchecked = checkboxes.some(c => !c.chk.checked);
		allChk.indeterminate = anyUnchecked && checkboxes.some(c => c.chk.checked);
	}

	// Footer buttons
	panel.createDiv({ cls: 'bt-fp-divider' });
	const foot     = panel.createDiv({ cls: 'bt-fp-footer' });
	const clearBtn = foot.createEl('button', { cls: 'bt-sp-clear-btn', text: t('filterClear') });
	const applyBtn = foot.createEl('button', { cls: 'bt-sp-apply',     text: t('apply') });

	let committed = false;
	let detachGlobalListeners: (() => void) | null = null;
	const close = () => {
		if (!committed) committed = true;
		panel.remove();
		if (closeActivePanel === doClose) closeActivePanel = null;
		detachGlobalListeners?.();
	};
	const doClose = close;
	closeActivePanel = doClose;

	clearBtn.addEventListener('click', () => {
		void onStructuralOp({ type: 'set-filter', colId: col.id, values: null });
		close();
	});
	applyBtn.addEventListener('click', () => {
		const selected = checkboxes.filter(c => c.chk.checked).map(c => c.value);
		const allSelected = selected.length === checkboxes.length;
		void onStructuralOp({ type: 'set-filter', colId: col.id, values: allSelected ? null : selected });
		close();
	});
	panel.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') { e.stopPropagation(); close(); }
		if (e.key === 'Enter')  { e.preventDefault(); applyBtn.click(); }
	});
	// Bound via component.registerDomEvent (not raw addEventListener) so an abrupt unload
	// (note closed/switched while the panel is open) still detaches this from activeDocument.
	window.setTimeout(() => {
		const outside = (e: MouseEvent) => {
			if (!panel.contains(e.target as Node)) close();
		};
		component.registerDomEvent(activeDocument, 'mousedown', outside);
		detachGlobalListeners = () => activeDocument.removeEventListener('mousedown', outside);
	}, 0);
}

/** Unified panel shown on double-click for all cell types (header / data / selection). */
function openCellPanel(config: CellPanelConfig): HTMLElement {
	// Close any panel that is currently open (restores preview styles on the old cells).
	closeActivePanel?.();

	const { component, anchor, els, existingStyle, inheritedStyle = {}, showTextColor, cellOps, typeSection, onApplyStyle } = config;

	const saved = els.map(e => ({
		bg:       e.style.getPropertyValue('background-color'),
		color:    e.style.getPropertyValue('color'),
		size:     e.style.getPropertyValue('font-size'),
		sizeVar:  e.style.getPropertyValue('--bt-cell-font-size'),
		bold:     e.hasClass('bt-bold'),
		italic:   e.hasClass('bt-italic'),
	}));
	const restoreEls = () => els.forEach((e, i) => {
		const s = saved[i];
		if (!s) return;
		if (s.bg)      e.style.setProperty('background-color', s.bg);          else e.style.removeProperty('background-color');
		if (s.color)   e.style.setProperty('color', s.color);                  else e.style.removeProperty('color');
		if (s.size)    e.style.setProperty('font-size', s.size);               else e.style.removeProperty('font-size');
		if (s.sizeVar) e.style.setProperty('--bt-cell-font-size', s.sizeVar);  else e.style.removeProperty('--bt-cell-font-size');
		e.toggleClass('bt-bold',   s.bold);
		e.toggleClass('bt-italic', s.italic);
	});

	const ar  = anchor.getBoundingClientRect();
	const PW  = 230;
	let   top  = ar.bottom + 4;
	let   left = ar.left;
	if (top  + 320 > activeWindow.innerHeight) top  = Math.max(8, ar.top - 320 - 4);
	if (left + PW  > activeWindow.innerWidth)  left = Math.max(8, ar.right - PW);
	top  = Math.max(8, top);
	left = Math.max(8, left);

	const panel = activeDocument.body.createDiv({ cls: 'bt-cell-panel' });
	panel.setCssProps({ '--bt-cp-top': `${top}px`, '--bt-cp-left': `${left}px` });

	// Cell ops
	if (cellOps.length > 0) {
		for (const op of cellOps) {
			const item = panel.createDiv({ cls: `bt-cp-item${op.danger ? ' bt-cp-danger' : ''}` });
			const iconEl = item.createSpan({ cls: 'bt-cp-item-icon' });
			setIcon(iconEl, op.icon);
			item.createSpan({ text: op.label });
			item.addEventListener('click', () => { op.action(); close(false); });
		}
		panel.createDiv({ cls: 'bt-cp-divider' });
	}

	// Style section
	const styleEl  = panel.createDiv({ cls: 'bt-cp-style' });
	const bgRow    = styleEl.createDiv({ cls: 'bt-cp-style-row' });
	bgRow.createSpan({ cls: 'bt-cp-style-label', text: t('background') });
	const bgWrap   = bgRow.createDiv({ cls: 'bt-sp-color-wrap' });
	const bgEnable = bgWrap.createEl('input', { attr: { type: 'checkbox' } });
	const bgPicker = bgWrap.createEl('input', { cls: 'bt-sp-color', attr: { type: 'color', value: existingStyle.bg ?? '#ffffff' } });
	bgEnable.checked  = !!existingStyle.bg;
	bgPicker.disabled = !bgEnable.checked;

	let colorEnable: HTMLInputElement | null = null;
	let colorPicker: HTMLInputElement | null = null;
	if (showTextColor) {
		const colorRow  = styleEl.createDiv({ cls: 'bt-cp-style-row' });
		colorRow.createSpan({ cls: 'bt-cp-style-label', text: t('textColor') });
		const colorWrap = colorRow.createDiv({ cls: 'bt-sp-color-wrap' });
		colorEnable = colorWrap.createEl('input', { attr: { type: 'checkbox' } });
		colorPicker = colorWrap.createEl('input', { cls: 'bt-sp-color', attr: { type: 'color', value: existingStyle.color ?? '#000000' } });
		colorEnable.checked  = !!existingStyle.color;
		colorPicker.disabled = !colorEnable.checked;
	}

	const sizeRow   = styleEl.createDiv({ cls: 'bt-cp-style-row' });
	sizeRow.createSpan({ cls: 'bt-cp-style-label', text: t('fontSize') });
	const sizeWrap  = sizeRow.createDiv({ cls: 'bt-sp-size-wrap' });
	const sizeInput = sizeWrap.createEl('input', { cls: 'bt-sp-size',
		attr: { type: 'number', min: '8', max: '72', step: '1', placeholder: 'Default',
		        value: existingStyle.size != null ? String(existingStyle.size) : '' },
	});
	sizeWrap.createSpan({ text: 'px' });

	let boldCheck: HTMLInputElement | null = null;
	let italicCheck: HTMLInputElement | null = null;
	if (config.showBoldItalic !== false) {
		const boldRow  = styleEl.createDiv({ cls: 'bt-cp-style-row' });
		boldRow.createSpan({ cls: 'bt-cp-style-label', text: t('bold') });
		boldCheck = boldRow.createEl('input', { attr: { type: 'checkbox' } });
		boldCheck.checked = !!existingStyle.bold;

		const italicRow  = styleEl.createDiv({ cls: 'bt-cp-style-row' });
		italicRow.createSpan({ cls: 'bt-cp-style-label', text: t('italic') });
		italicCheck = italicRow.createEl('input', { attr: { type: 'checkbox' } });
		italicCheck.checked = !!existingStyle.italic;
	}

	const styleFoot = styleEl.createDiv({ cls: 'bt-cp-style-footer' });
	const clearBtn  = styleFoot.createEl('button', { cls: 'bt-sp-clear-btn', text: t('clearFormat') });
	const applyBtn  = styleFoot.createEl('button', { cls: 'bt-sp-apply',     text: t('apply') });

	const preview = () => {
		// When a checkbox is unchecked, fall back to the inherited value.
		const bv = bgEnable.checked ? bgPicker.value : (inheritedStyle.bg ?? null);
		const cv = colorEnable?.checked && colorPicker ? colorPicker.value : (inheritedStyle.color ?? null);
		const ss = sizeInput.value.trim();
		const sv = ss ? `${parseInt(ss, 10)}px` : (inheritedStyle.size ? `${inheritedStyle.size}px` : null);
		for (const e of els) {
			if (bv)    e.style.setProperty('background-color', bv);  else e.style.removeProperty('background-color');
			if (cv)    e.style.setProperty('color', cv);             else e.style.removeProperty('color');
			if (sv) {
				e.style.setProperty('font-size', sv);
				e.style.setProperty('--bt-cell-font-size', sv);
			} else {
				e.style.removeProperty('font-size');
				e.style.removeProperty('--bt-cell-font-size');
			}
			e.toggleClass('bt-bold',   !!(boldCheck?.checked   || (inheritedStyle.bold   && !boldCheck?.checked)));
			e.toggleClass('bt-italic', !!(italicCheck?.checked || (inheritedStyle.italic && !italicCheck?.checked)));
		}
	};
	bgEnable.addEventListener('change', () => { bgPicker.disabled = !bgEnable.checked; preview(); });
	bgPicker.addEventListener('input', preview);
	colorEnable?.addEventListener('change', () => { if (colorPicker) colorPicker.disabled = !colorEnable?.checked; preview(); });
	colorPicker?.addEventListener('input', preview);
	sizeInput.addEventListener('input', preview);
	boldCheck?.addEventListener('change', preview);
	italicCheck?.addEventListener('change', preview);

	// Type section
	if (typeSection) {
		panel.createDiv({ cls: 'bt-cp-divider' });
		const typeRow  = panel.createDiv({ cls: 'bt-cp-type-row' });
		const typeLeft = typeRow.createDiv({ cls: 'bt-cp-type-left' });
		const tIcon    = typeLeft.createSpan({ cls: 'bt-cp-item-icon' });
		setIcon(tIcon, 'tag');
		typeLeft.createSpan({ text: typeLabel(typeSection.currentType) });
		typeRow.createSpan({ cls: 'bt-cp-chevron', text: '›' });
		typeRow.addEventListener('click', (evt: MouseEvent) => {
			const m = new Menu();
			m.addItem(i => { i.setTitle(t('noType')); if (!typeSection.currentType) i.setChecked(true); i.onClick(() => void typeSection.onColTypeChange(typeSection.colIdx, undefined)); });
			m.addSeparator();
			for (const id of SPECIAL_TYPES) {
				m.addItem(i => { i.setTitle(id); if (id === typeSection.currentType) i.setChecked(true); i.onClick(() => void typeSection.onColTypeChange(typeSection.colIdx, id)); });
			}
			m.addSeparator();
			for (const ct of typeSection.getRegistry().getAllTypes()) {
				m.addItem(i => { i.setTitle(ct.id); if (ct.id === typeSection.currentType) i.setChecked(true); i.onClick(() => void typeSection.onColTypeChange(typeSection.colIdx, ct.id)); });
			}
			m.showAtMouseEvent(evt);
		});
	}

	// Actions
	let committed = false;
	let detachGlobalListeners: (() => void) | null = null;
	const close = (restore: boolean) => {
		if (!committed) { if (restore) restoreEls(); committed = true; }
		panel.remove();
		if (closeActivePanel === thisClose) closeActivePanel = null;
		detachGlobalListeners?.();
		config.onClose?.();
	};
	const thisClose = () => close(true);
	closeActivePanel = thisClose;
	clearBtn.addEventListener('click', () => { onApplyStyle(null, null, null, null, null); close(false); });
	applyBtn.addEventListener('click', () => {
		onApplyStyle(
			bgEnable.checked ? bgPicker.value : null,
			colorEnable?.checked ? (colorPicker?.value ?? null) : null,
			sizeInput.value.trim() ? parseInt(sizeInput.value.trim(), 10) : null,
			boldCheck ? (boldCheck.checked ? true : null) : null,
			italicCheck ? (italicCheck.checked ? true : null) : null,
		);
		close(false);
	});
	// Enter in the panel (not in size input) confirms; handled here for when a
	// panel control has focus.
	panel.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' && evt.target !== sizeInput) { evt.preventDefault(); applyBtn.click(); }
	});
	// Escape and outside-click close the panel regardless of where focus is. Bound via
	// component.registerDomEvent (not raw addEventListener) so an abrupt unload (note closed/
	// switched while the panel is open) still detaches these from activeDocument.
	window.setTimeout(() => {
		const outside = (evt: MouseEvent) => {
			if (!panel.contains(evt.target as Node)) close(true);
		};
		const escKey = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') { evt.stopPropagation(); close(true); }
		};
		component.registerDomEvent(activeDocument, 'mousedown', outside);
		component.registerDomEvent(activeDocument, 'keydown', escKey);
		detachGlobalListeners = () => {
			activeDocument.removeEventListener('mousedown', outside);
			activeDocument.removeEventListener('keydown', escKey);
		};
	}, 0);
	return panel;
}

function enterDateEditMode(
	el: HTMLElement,
	currentValue: string,
	rowIdx: number,
	colIdx: number,
	onCellChange: CellChangeHandler,
): void {
	const savedNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));
	el.empty();
	el.addClass('bt-editing');

	const input = el.createEl('input', {
		cls: 'bt-date-input',
		attr: { type: 'date', value: currentValue },
	});

	let committed = false;

	const save = () => {
		if (committed) return;
		committed = true;
		el.removeClass('bt-editing');
		if (input.value !== currentValue) {
			void onCellChange(rowIdx, colIdx, input.value);
		} else {
			el.empty();
			for (const node of savedNodes) el.appendChild(node);
		}
	};

	const cancel = () => {
		if (committed) return;
		committed = true;
		input.removeEventListener('blur', save);
		el.removeClass('bt-editing');
		el.empty();
		for (const node of savedNodes) el.appendChild(node);
	};

	input.addEventListener('blur', save);
	input.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter') { evt.preventDefault(); input.blur(); }
		if (evt.key === 'Escape') { evt.preventDefault(); cancel(); }
	});

	input.focus();
}

/**
 * Inline editor for title (single-line) and footer (multi-line).
 * Single-line: Enter = save, Escape = cancel.
 * Multi-line:  Enter = newline, Shift+Enter = save, Escape = cancel.
 */
function enterLineEdit(
	el: HTMLElement,
	currentText: string,
	onSave: (newText: string) => void,
	multiLine = false,
): void {
	const savedNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));
	el.empty();
	el.addClass('bt-editing');

	let committed = false;

	if (multiLine) {
		const textarea = el.createEl('textarea', { cls: 'bt-inline-editor bt-inline-editor-multi' });
		textarea.value = currentText;
		textarea.rows  = Math.max(2, currentText.split('\n').length);

		const save = () => {
			if (committed) return;
			committed = true;
			el.removeClass('bt-editing');
			const newVal = textarea.value.trim();
			if (newVal !== currentText) onSave(newVal);
			else { el.empty(); for (const n of savedNodes) el.appendChild(n); }
		};
		const cancel = () => {
			if (committed) return;
			committed = true;
			textarea.removeEventListener('blur', save);
			el.removeClass('bt-editing');
			el.empty();
			for (const n of savedNodes) el.appendChild(n);
		};

		textarea.addEventListener('blur', save);
		textarea.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') { evt.preventDefault(); cancel(); }
			if (evt.key === 'Enter' && evt.shiftKey) { evt.preventDefault(); textarea.blur(); }
		});
		textarea.focus();
		// Move cursor to end so Enter adds a line break rather than replacing all text
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		return;
	}

	const editor = el.createDiv({
		cls: 'bt-inline-editor',
		attr: { contenteditable: 'true' },
	});
	editor.textContent = currentText;

	const save = () => {
		if (committed) return;
		committed = true;
		el.removeClass('bt-editing');
		const newVal = (editor.textContent ?? '').trim();
		if (newVal !== currentText) onSave(newVal);
		else { el.empty(); for (const n of savedNodes) el.appendChild(n); }
	};

	const cancel = () => {
		if (committed) return;
		committed = true;
		editor.removeEventListener('blur', save);
		el.removeClass('bt-editing');
		el.empty();
		for (const n of savedNodes) el.appendChild(n);
	};

	editor.addEventListener('blur', save);
	editor.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter') { evt.preventDefault(); editor.blur(); }
		if (evt.key === 'Escape') { evt.preventDefault(); cancel(); }
	});

	editor.focus();
	if (activeDocument.contains(editor)) {
		const range = activeDocument.createRange();
		range.selectNodeContents(editor);
		activeWindow.getSelection()?.removeAllRanges();
		activeWindow.getSelection()?.addRange(range);
	}
}

/**
 * Replaces cell content with a contenteditable div wired to WikilinkInputSuggest
 * (AbstractInputSuggest subclass) for native Obsidian wikilink suggestions.
 * Save on blur/Enter, cancel on Escape; pre-edit nodes restored on cancel.
 */
function enterEditMode(
	el: HTMLElement,
	rawValue: string,
	rowIdx: number,
	colIdx: number,
	app: App,
	sourcePath: string,
	onCellChange: CellChangeHandler,
): void {
	const savedNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));

	const restoreNodes = () => {
		el.empty();
		for (const node of savedNodes) el.appendChild(node);
	};

	el.empty();
	el.addClass('bt-editing');

	// contenteditable div — accepted by AbstractInputSuggest natively
	const editor = el.createDiv({
		cls: 'bt-cell-editor',
		attr: { contenteditable: 'true' },
	});
	editor.textContent = rawValue;

	// WikilinkInputSuggest attaches to the div directly (no hacks needed)
	new WikilinkInputSuggest(app, editor, sourcePath);

	let committed = false;

	const save = () => {
		if (committed) return;
		committed = true;
		el.removeClass('bt-editing');
		const newValue = editor.textContent ?? '';
		if (newValue !== rawValue) {
			void onCellChange(rowIdx, colIdx, newValue);
		} else {
			restoreNodes();
		}
	};

	const cancel = () => {
		if (committed) return;
		committed = true;
		editor.removeEventListener('blur', save);
		el.removeClass('bt-editing');
		restoreNodes();
	};

	editor.addEventListener('blur', save);
	editor.addEventListener('keydown', (evt: KeyboardEvent) => {
		// Stop Ctrl/Meta combos from bubbling to Obsidian's CodeMirror handlers.
		// The browser handles Ctrl+V / Ctrl+Z / Ctrl+A natively for contenteditable,
		// so blocking propagation only prevents Obsidian shortcuts (e.g. Ctrl+Shift+V
		// "paste without formatting") from accidentally firing on the code block.
		if (evt.ctrlKey || evt.metaKey) evt.stopPropagation();

		if (evt.key === 'Enter' && !evt.shiftKey) {
			evt.preventDefault();
			editor.blur();
		} else if (evt.key === 'Escape') {
			evt.preventDefault();
			cancel();
		}
	});

	// Focus and select all existing text
	editor.focus();
	if (activeDocument.contains(editor)) {
		const range = activeDocument.createRange();
		range.selectNodeContents(editor);
		activeWindow.getSelection()?.removeAllRanges();
		activeWindow.getSelection()?.addRange(range);
	}
}

/** Returns true when displayIdx (1-based, 0=header) should be hidden by active filters. */
function isRowFiltered(displayIdx: number, model: TableModelV2): boolean {
	if (!model.filter || displayIdx === 0) return false;
	const row = model.rows[displayIdx - 1];
	if (!row) return false;
	for (const [cId, values] of Object.entries(model.filter)) {
		if (!values || values.length === 0) continue;
		const cellValue = (row.cells[cId] ?? '').trim();
		if (!values.includes(cellValue)) return true;
	}
	return false;
}

function applyColStyle(el: HTMLElement, col: ColumnDefV2): void {
	// Width is now controlled solely by <colgroup>/<col> — no CSS variable needed
	if (col.align) el.addClass(`bt-align-${col.align}`);
}

/**
 * Minimum column width based on content.
 * For typed columns the widest option label determines the minimum so choice
 * pills are never cut off.  Uses ~8px per character + 24px padding/chrome.
 */
function colMinWidth(col: ColumnDefV2, registry: ChoiceRegistry): number {
	const base = 40;
	if (!col.type || SPECIAL_TYPES.has(col.type)) return base;
	const ct = registry.get(col.type);
	if (!ct || ct.options.length === 0) return base;
	const maxLen = Math.max(...ct.options.map(o => (o.label ?? o.value).length));
	return Math.max(base, maxLen * 8 + 24);
}

/**
 * Auto-fit a column's width to the widest content among its cells. Measures each
 * cell in place: toggles white-space:nowrap on its content to get the intrinsic
 * single-line width, then restores it. For a single column this read-after-write
 * per cell is cheap; auto-fitting every column at once uses autoFitAllColWidths
 * instead, which batches the same measurement to avoid forcing a reflow per cell.
 */
function autoFitColWidth(tbl: HTMLElement, colIdx: number, minW: number): number {
	const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-col="${colIdx}"]`));
	if (cells.length === 0) return minW;

	let max = minW;
	for (const cell of cells) {
		// Skip cells that span multiple columns — their content is shared across columns
		// and would inflate the auto-fit width of just this one column.
		if (cell.tagName === 'TD' || cell.tagName === 'TH') {
			if ((cell as HTMLTableCellElement).colSpan > 1) continue;
		}

		const view = activeDocument.defaultView;
		const style = view ? view.getComputedStyle(cell) : null;
		// Horizontal padding of the cell
		const padH = style
			? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
			: 24;
		// Border width contribution (border-collapse: collapse, ~1px each side)
		const borderH = style
			? parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
			: 2;

		// 1. Typed cell: pill is inline-flex with white-space:nowrap;
		//    offsetWidth is the natural pill width regardless of cell clipping.
		const pill = cell.querySelector<HTMLElement>('.bt-choice');
		if (pill) {
			max = Math.max(max, pill.offsetWidth + padH + borderH);
			continue;
		}

		// 2. Header cell: measure the inline text span (not the cell itself).
		//    cell.scrollWidth == clientWidth == current column width for table-cell
		//    elements — useless. The inline span's offsetWidth is the actual text width —
		//    but only once it's forced to one line first: if the column is already too
		//    narrow, the header text is already wrapped, and offsetWidth on a wrapped
		//    inline span reports the widest wrapped line, not the text's true natural
		//    width, which would just confirm the too-narrow width forever.
		const textSpan = cell.querySelector<HTMLElement>('.bt-th-text');
		if (textSpan) {
			textSpan.addClass('bt-nowrap-measure');
			const w = textSpan.offsetWidth;
			textSpan.removeClass('bt-nowrap-measure');
			// Buffer by one letter-spacing unit — engines don't consistently include the
			// trailing letter-spacing after the last character in the measured width, so a
			// theme with non-zero letter-spacing (e.g. plain's bold header text) can measure
			// a hair short of what's actually needed to avoid wrapping.
			const spanStyle = view ? view.getComputedStyle(textSpan) : null;
			const letterSpacing = spanStyle ? parseFloat(spanStyle.letterSpacing) || 0 : 0;
			max = Math.max(max, w + letterSpacing + padH + borderH);
			continue;
		}

		// 3. Data cell with text: measure natural single-line width.
		//    Two compounding problems:
		//    a) Selecting the cell itself returns the block <p>'s layout width (= cell width).
		//       Fix: select the *contents* of each <p> (inline nodes only).
		//    b) If text is already wrapping, inline line-boxes span the full content area,
		//       so their union rect width still equals the cell width — no auto-fit effect.
		//       Fix: temporarily set white-space:nowrap on the <p> to collapse to one line,
		//       measure the natural width, then restore.
		const text = cell.textContent?.trim() ?? '';
		if (text) {
			const pEls = Array.from(cell.querySelectorAll<HTMLElement>('p'));
			const targets: HTMLElement[] = pEls.length > 0 ? pEls : [cell];
			for (const target of targets) {
				target.addClass('bt-nowrap-measure');
				const range = activeDocument.createRange();
				range.selectNodeContents(target);
				const rw = range.getBoundingClientRect().width;
				target.removeClass('bt-nowrap-measure');
				if (rw > 0) max = Math.max(max, rw + padH + borderH);
			}
		}
		// Empty data cell: skip — its scrollWidth == current cell width,
		// using it would cause the column to grow on every double-click.
	}
	return Math.ceil(max);
}

/**
 * Auto-fit every column's width in one pass. autoFitColWidth measures a single column
 * by toggling white-space:nowrap and reading the result per cell — interleaving those
 * writes and reads across every cell in every column forces one synchronous layout per
 * cell (classic layout thrashing), which gets dramatically slower under heavy theme CSS
 * (animations, gradients, filters make every forced layout more expensive). This does
 * the same measurement but strictly phased — add every nowrap class first, read every
 * width in one batch, then remove every class — so the browser only needs one layout
 * pass for the whole table instead of one per cell.
 */
function autoFitAllColWidths(
	tbl: HTMLElement,
	cols: { colIdx: number; minW: number }[],
): Map<number, number> {
	const results = new Map<number, number>();
	for (const { colIdx, minW } of cols) results.set(colIdx, minW);

	const pills:      { colIdx: number; el: HTMLElement }[] = [];
	const textSpans:  { colIdx: number; el: HTMLElement }[] = [];
	const nowrapEls:  { colIdx: number; el: HTMLElement }[] = [];

	// Phase 1 — classify cells and apply the one write each nowrap target needs. No reads yet.
	for (const { colIdx } of cols) {
		const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-col="${colIdx}"]`));
		for (const cell of cells) {
			if ((cell.tagName === 'TD' || cell.tagName === 'TH') && (cell as HTMLTableCellElement).colSpan > 1) continue;

			const pill = cell.querySelector<HTMLElement>('.bt-choice');
			if (pill) { pills.push({ colIdx, el: pill }); continue; }
			// Force nowrap before reading offsetWidth below — if the column is already too
			// narrow, the header text is already wrapped, and offsetWidth on a wrapped inline
			// span reports the widest wrapped line, not the text's true natural width.
			const textSpan = cell.querySelector<HTMLElement>('.bt-th-text');
			if (textSpan) { textSpan.addClass('bt-nowrap-measure'); textSpans.push({ colIdx, el: textSpan }); continue; }
			const text = cell.textContent?.trim() ?? '';
			if (!text) continue;
			const pEls = Array.from(cell.querySelectorAll<HTMLElement>('p'));
			const targets = pEls.length > 0 ? pEls : [cell];
			for (const target of targets) {
				target.addClass('bt-nowrap-measure');
				nowrapEls.push({ colIdx, el: target });
			}
		}
	}

	// Phase 2 — read everything. No writes are interleaved here, so the browser
	// computes layout once (lazily, on the first read below) and reuses it for the rest.
	const view = activeDocument.defaultView;
	const grow = (colIdx: number, w: number) => {
		results.set(colIdx, Math.max(results.get(colIdx) ?? 0, w));
	};
	const padBorder = (cell: HTMLElement) => {
		const style = view ? view.getComputedStyle(cell) : null;
		return {
			padH:    style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 24,
			borderH: style ? parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) : 2,
		};
	};
	for (const { colIdx, el } of pills) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		grow(colIdx, el.offsetWidth + padH + borderH);
	}
	for (const { colIdx, el } of textSpans) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		// Buffer by one letter-spacing unit — see autoFitColWidth's header-cell comment.
		const style = view ? view.getComputedStyle(el) : null;
		const letterSpacing = style ? parseFloat(style.letterSpacing) || 0 : 0;
		grow(colIdx, el.offsetWidth + letterSpacing + padH + borderH);
	}
	for (const { colIdx, el } of nowrapEls) {
		const { padH, borderH } = padBorder(el.closest<HTMLElement>('td, th') ?? el);
		const range = activeDocument.createRange();
		range.selectNodeContents(el);
		const rw = range.getBoundingClientRect().width;
		if (rw > 0) grow(colIdx, rw + padH + borderH);
	}

	// Phase 3 — cleanup writes.
	for (const { el } of nowrapEls) el.removeClass('bt-nowrap-measure');
	for (const { el } of textSpans) el.removeClass('bt-nowrap-measure');

	for (const [colIdx, w] of results) results.set(colIdx, Math.ceil(w));
	return results;
}

/** Viewport x of a column's right edge, summing <col> widths in DOM order. */
function colRightX(tbl: HTMLElement, colIdx: number): number {
	let x = tbl.getBoundingClientRect().left;
	for (const c of Array.from(tbl.querySelectorAll<HTMLElement>('col'))) {
		x += parseInt(c.style.width) || 0;
		if (c.dataset.col !== undefined && parseInt(c.dataset.col) === colIdx) break;
	}
	return x;
}

/**
 * Wire a handle element to resize column `colIdx`: hover/drag indicator line,
 * live <col> width update, table-width re-pin, double-click auto-fit, and commit.
 * The boundary is computed from <col> geometry (colRightX) so it works even when
 * the column is covered by a header merge and has no individual header cell.
 */
function setupColResize(
	handle: HTMLElement,
	tbl: HTMLElement,
	colIdx: number,
	getRegistry: () => ChoiceRegistry,
	model: TableModelV2,
	onStructuralOp: StructuralOpHandler,
	component?: Component,
): void {
	const col = model.columns[colIdx];
	const thisCol = tbl.querySelector<HTMLElement>(`col[data-col="${colIdx}"]`);
	if (!col || !thisCol) return;
	const allCols = Array.from(tbl.querySelectorAll<HTMLElement>('col[data-col]'));
	const nextCol = allCols.find(c => parseInt(c.dataset.col ?? '-1') > colIdx) ?? null;

	handle.addEventListener('click', e => e.stopPropagation());

	let colLine: HTMLElement | null = null;
	let colDragging = false;
	const hideColLine = () => { colLine?.remove(); colLine = null; };
	component?.register(hideColLine);

	const makeColLine = (tblRect: DOMRect): HTMLElement => {
		const line = activeDocument.body.createDiv({ cls: 'bt-resize-indicator bt-resize-indicator-col' });
		line.setCssProps({
			'--ri-x':      `${colRightX(tbl, colIdx)}px`,
			'--ri-top':    `${tblRect.top}px`,
			'--ri-height': `${tblRect.height}px`,
		});
		return line;
	};

	handle.addEventListener('mouseenter', () => {
		if (colLine || colDragging) return;
		colLine = makeColLine(tbl.getBoundingClientRect());
		colLine.setCssProps({ '--bt-ri-opacity': '0.4' });
	});
	handle.addEventListener('mouseleave', () => {
		if (!colDragging) hideColLine();
	});

	handle.addEventListener('dblclick', (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		hideColLine();
		const fit = autoFitColWidth(tbl, colIdx, colMinWidth(col, getRegistry()));
		void onStructuralOp({ type: 'set-col-width', colId: col.id, width: fit });
	});

	handle.addEventListener('pointerdown', (e: PointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		handle.setPointerCapture(e.pointerId);
		colDragging = true;

		const startX     = e.clientX;
		const startW     = parseInt(thisCol.style.width) || (col.width ?? 120);
		const startNextW = nextCol ? (parseInt(nextCol.style.width) || 120) : null;
		const nextColIdx = nextCol ? parseInt(nextCol.dataset.col ?? '-1') : -1;
		const MIN        = colMinWidth(col, getRegistry());
		const tblRect    = tbl.getBoundingClientRect();

		if (colLine) colLine.setCssProps({ '--bt-ri-opacity': '0.75' });
		else { colLine = makeColLine(tblRect); colLine.setCssProps({ '--bt-ri-opacity': '0.75' }); }

		const onMove = (ev: PointerEvent) => {
			const delta = ev.clientX - startX;
			const newW  = Math.max(MIN, startW + delta);
			thisCol.style.setProperty('width', `${newW}px`);
			if (nextCol && startNextW !== null) {
				const nextColDef2 = nextColIdx >= 0 ? model.columns[nextColIdx] : undefined;
				const nextMIN = nextColDef2 ? colMinWidth(nextColDef2, getRegistry()) : 40;
				nextCol.style.setProperty('width', `${Math.max(nextMIN, startNextW - delta)}px`);
			}
			const sum = Array.from(tbl.querySelectorAll<HTMLElement>('col'))
				.reduce((s, c) => s + (parseInt(c.style.width) || 0), 0);
			tbl.style.setProperty('width', `${sum}px`);

			if (colLine) colLine.setCssProps({ '--ri-x': `${colRightX(tbl, colIdx)}px` });
			// Grid auto-updates edge-add strip sizes — no manual repositioning needed.
			tbl.dispatchEvent(new CustomEvent('bt-layout-changed'));
		};

		const onUp = (ev: PointerEvent) => {
			handle.removeEventListener('pointermove', onMove);
			colDragging = false;
			hideColLine();
			const delta = ev.clientX - startX;
			if (delta === 0) return;
			void onStructuralOp({ type: 'set-col-width', colId: col.id, width: Math.max(MIN, startW + delta) });
			if (nextCol && startNextW !== null && nextColIdx >= 0) {
				const nextColDef = model.columns[nextColIdx];
				if (nextColDef) {
					const nextMIN = colMinWidth(nextColDef, getRegistry());
					void onStructuralOp({ type: 'set-col-width', colId: nextColDef.id, width: Math.max(nextMIN, startNextW - delta) });
				}
			}
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp, { once: true });
	});
}

/** Auto-fit a row's height to its content by measuring cells without a forced height. */
function autoFitRowHeight(tbl: HTMLElement, rowIdx: number, minH: number): number {
	const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-row="${rowIdx}"]`));
	if (cells.length === 0) return minH;
	// Exclude rowspan > 1 cells: their offsetHeight spans multiple rows so measuring
	// them would inflate the single-row height (same guard as bindResizeHandle).
	const single = cells.filter(c => (c as HTMLTableCellElement).rowSpan <= 1);
	const targets = single.length > 0 ? single : cells;
	// Temporarily clear the forced height so cells collapse to content, measure, restore.
	const saved = cells.map(c => c.style.getPropertyValue('--bt-row-height'));
	cells.forEach(c => c.style.removeProperty('--bt-row-height'));
	let max = minH;
	for (const c of targets) max = Math.max(max, c.offsetHeight);
	cells.forEach((c, i) => { const s = saved[i]; if (s) c.style.setProperty('--bt-row-height', s); });
	return Math.ceil(max);
}

function bindResizeHandle(
	handle: HTMLElement,
	table: HTMLElement,
	dataAttr: string,
	cssVar: string,
	minSize: number,
	onCommit: (size: number) => void,
	component: Component,
	onDrag?: () => void,
): void {
	// Shared hover+drag indicator line
	let rowLine: HTMLElement | null = null;
	let rowDragging = false;
	const hideRowLine = () => { rowLine?.remove(); rowLine = null; };
	component.register(hideRowLine);

	// Clicks on the seam must not bubble to the cell's click-to-edit handler
	handle.addEventListener('click', e => e.stopPropagation());

	// Cells that belong to exactly this one row (exclude rowspan cells whose height
	// spans multiple rows — using them would measure/set the whole merge, making the
	// indicator sit at the merge bottom and the drag magnitude mismatch the pointer).
	const rowCells = (): HTMLElement[] => {
		const all = Array.from(table.querySelectorAll<HTMLElement>(`[${dataAttr}]`));
		const single = all.filter(c => (c as HTMLTableCellElement).rowSpan <= 1);
		return single.length > 0 ? single : all;
	};

	const makeRowLine = (anchor: HTMLElement | undefined, tblRect: DOMRect): HTMLElement => {
		const line = activeDocument.body.createDiv({ cls: 'bt-resize-indicator bt-resize-indicator-row' });
		const borderY = anchor ? anchor.getBoundingClientRect().bottom : tblRect.bottom;
		line.setCssProps({ '--ri-y': `${borderY}px`, '--ri-left': `${tblRect.left}px`, '--ri-width': `${tblRect.width}px` });
		return line;
	};

	handle.addEventListener('mouseenter', () => {
		if (rowLine || rowDragging) return;
		rowLine = makeRowLine(rowCells()[0], table.getBoundingClientRect());
		rowLine.setCssProps({ '--bt-ri-opacity': '0.4' });
	});
	handle.addEventListener('mouseleave', () => {
		if (!rowDragging) hideRowLine();
	});

	handle.addEventListener('pointerdown', (e: PointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		handle.setPointerCapture(e.pointerId);
		rowDragging = true;

		const startCoord = e.clientY;
		// Only cells that belong to this row alone — anchor + height targets
		const targets   = rowCells();
		const anchor    = targets[0];
		const tblRect   = table.getBoundingClientRect();

		// Read actual height at drag time — avoids the detached-div zero issue
		const actualStart = (anchor?.offsetHeight ?? 0) || minSize;
		let lastSize = actualStart;
		let hasMoved = false;

		// Upgrade hover line or create fresh one
		if (rowLine) rowLine.setCssProps({ '--bt-ri-opacity': '0.75' });
		else { rowLine = makeRowLine(anchor, tblRect); rowLine.setCssProps({ '--bt-ri-opacity': '0.75' }); }

		const onMove = (ev: PointerEvent) => {
			// Capture scroll position before the height change so we can restore it
			// after scroll-anchoring fires — preventing the page from jumping up.
			const scrollEl = activeDocument.scrollingElement;
			const savedScrollTop = scrollEl?.scrollTop;

			const delta = ev.clientY - startCoord;
			lastSize = Math.max(minSize, Math.round(actualStart + delta));
			for (const cell of targets) cell.style.setProperty(cssVar, `${lastSize}px`);
			// Track actual cell bottom edge live — handles content min-height correctly
			if (rowLine && anchor) {
				rowLine.setCssProps({ '--ri-y': `${anchor.getBoundingClientRect().bottom}px` });
			}
			onDrag?.();
			// Row height change shifts cell geometry → rebuild selector strips to follow
			table.dispatchEvent(new CustomEvent('bt-layout-changed'));
			hasMoved = true;

			// Restore scroll in the next animation frame (runs before paint, after
			// scroll-anchoring fires) to cancel any upward page compensation.
			if (scrollEl && savedScrollTop !== undefined) {
				window.requestAnimationFrame(() => { scrollEl.scrollTop = savedScrollTop; });
			}
		};

		const onUp = () => {
			handle.removeEventListener('pointermove', onMove);
			rowDragging = false;
			hideRowLine();
			if (!hasMoved) return;
			onCommit(lastSize);
			// (click on the handle is already blocked by the permanent stopPropagation above)
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp, { once: true });
	});
}

function applyStyleRulesV2(el: HTMLElement, rowIdx: number, colIdx: number, model: TableModelV2): void {
	const col = model.columns[colIdx];
	if (!col) return;
	let rs: ResolvedStyleV2;
	if (rowIdx === 0) {
		rs = resolveHeaderStylesV2(model.styles, col.id);
	} else {
		const row = model.rows[rowIdx - 1];
		if (!row) return;
		rs = resolveStylesV2(model.styles, row.id, col.id, model);
	}
	applyResolvedStyle(el, rs);
}

interface ResolvedMerge {
	anchorRowId: string; anchorColId: string;
	endRowId:    string; endColId:    string;
	startRow:    number; endRow:      number;  // 1-based display indices
	startCol:    number; endCol:      number;  // 0-based column indices
}

function buildOccupied(model: TableModelV2): Set<string> {
	const occupied = new Set<string>();
	for (const m of model.merges) {
		const dotA = m.anchor.indexOf('.');
		const dotE = m.end.indexOf('.');
		if (dotA < 0 || dotE < 0) continue;
		const anchorRowId = m.anchor.slice(0, dotA);
		const anchorColId = m.anchor.slice(dotA + 1);
		const endRowId    = m.end.slice(0, dotE);
		const endColId    = m.end.slice(dotE + 1);
		const r1 = model.rows.findIndex(r => r.id === anchorRowId);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const r2 = model.rows.findIndex(r => r.id === endRowId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0) continue;
		// If the literal anchor row/col is hidden, the merge survives by promoting the
		// effective anchor to the first visible row/col within the range — the merge
		// still displays (with the literal anchor's content, see renderRow) instead of
		// collapsing into empty standalone cells. Only give up if the whole range is hidden.
		let effR1 = r1;
		while (effR1 <= r2 && model.rows[effR1]?.hidden) effR1++;
		let effC1 = c1;
		while (effC1 <= c2 && model.columns[effC1]?.hidden) effC1++;
		if (effR1 > r2 || effC1 > c2) continue;
		for (let ri = effR1; ri <= r2; ri++) {
			for (let ci = effC1; ci <= c2; ci++) {
				if (ri === effR1 && ci === effC1) continue; // effective anchor is not occupied
				const rId = model.rows[ri]?.id ?? '';
				const cId = model.columns[ci]?.id ?? '';
				if (rId && cId) occupied.add(`${rId}.${cId}`);
			}
		}
	}
	return occupied;
}

/** Number of visible cells per row (visible cols + one indicator per hidden group). */
function countVisibleCells(model: TableModelV2): number {
	let count = 0;
	let inHiddenGroup = false;
	for (const col of model.columns) {
		if (col.hidden) {
			if (!inHiddenGroup) { count++; inHiddenGroup = true; }
		} else {
			count++;
			inHiddenGroup = false;
		}
	}
	return count;
}

function getMergeOrigin(rowIdx: number, colIdx: number, model: TableModelV2): ResolvedMerge | undefined {
	if (rowIdx === 0) return undefined; // header row cannot be a merge origin
	const row = model.rows[rowIdx - 1];
	const col = model.columns[colIdx];
	if (!row || !col) return undefined;
	for (const m of model.merges) {
		const dotA = m.anchor.indexOf('.');
		const dotE = m.end.indexOf('.');
		if (dotA < 0 || dotE < 0) continue;
		const anchorRowId = m.anchor.slice(0, dotA);
		const anchorColId = m.anchor.slice(dotA + 1);
		const endRowId = m.end.slice(0, dotE);
		const endColId = m.end.slice(dotE + 1);
		const r1 = model.rows.findIndex(r => r.id === anchorRowId);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const r2 = model.rows.findIndex(r => r.id === endRowId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0) continue;
		// Match against the effective anchor (promoted past a hidden literal anchor row/col,
		// same rule as buildOccupied) — see the "Table format versioning"-adjacent comment
		// in buildOccupied for why. anchorRowId/anchorColId stay literal for style targets
		// and unmerge, which key off the merge record's actual identity, not the render position.
		let effR1 = r1;
		while (effR1 <= r2 && model.rows[effR1]?.hidden) effR1++;
		let effC1 = c1;
		while (effC1 <= c2 && model.columns[effC1]?.hidden) effC1++;
		if (effR1 > r2 || effC1 > c2) continue;
		if (rowIdx - 1 !== effR1 || colIdx !== effC1) continue;
		return {
			anchorRowId, anchorColId, endRowId, endColId,
			startRow: rowIdx, startCol: colIdx,
			endRow:   r2 + 1, endCol:   c2,  // 1-based
		};
	}
	return undefined;
}
