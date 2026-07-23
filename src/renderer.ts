import { App, Component, Menu, setIcon } from 'obsidian';
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
		onCellChange, onColTypeChange, onStructuralOp,
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
				onCellChange, onColTypeChange, onStructuralOp,
			});
			di++;
		}
		renderAggregateRows(tbody, model);
	}

	// TODO: filter status bar ("Showing X of Y rows · Clear filter") — deferred until
	// a unified table status bar is designed that can also host sort info.

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
				menu.showAtMouseEvent(evt);
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
				menu.showAtMouseEvent(evt);
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
						m.showAtMouseEvent(e);
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
						moreMenu.showAtMouseEvent(evt);
					} },
				];
			})() : [];

			const cellOps: CellOpEntry[] = axis === 'col' ? [
				{ icon: 'eye-off', label: hideColsLabel(lo, hi, colIndexToLetter),
					action: () => { for (let ci = lo; ci <= hi; ci++) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
				{ icon: 'trash',   label: deleteColsLabel(lo, hi, colIndexToLetter), danger: true,
					action: () => { for (let ci = hi; ci >= lo; ci--) { const id = colId(model, ci); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
				...(sortOps.length > 0 ? [{ divider: true } as CellOpEntry, ...sortOps] : []),
				...(aggOps.length > 0 ? [{ divider: true } as CellOpEntry, ...aggOps] : []),
				{ divider: true },
				...copyOps,
			] : lo === 0 && hi === 0 ? copyOps : [  // no hide/delete for header row
				{ icon: 'eye-off', label: hideRowsLabel(lo, hi),
					action: () => { for (let ri = lo; ri <= hi; ri++) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
				{ icon: 'trash',   label: deleteRowsLabel(lo, hi), danger: true,
					action: () => { for (let ri = hi; ri >= lo; ri--) { const id = rowId(model, ri); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
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


