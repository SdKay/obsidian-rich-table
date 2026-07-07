import { App, Component, MarkdownRenderer, Menu, setIcon } from 'obsidian';
import {
	t, typeLabel,
	hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel,
} from './i18n';
import { WikilinkInputSuggest } from './wikilinkInputSuggest';
import type { ColumnDef, MergeRange, StyleRule, TableModel } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { StructuralOp } from './operations';
import { colLetterToIndex, colIndexToLetter, parseCellCoord } from './utils';

type CellChangeHandler    = (row: number, col: number, value: string) => Promise<void>;
type ColTypeChangeHandler = (colIdx: number, newType: string | undefined) => Promise<void>;
type StructuralOpHandler  = (op: StructuralOp) => Promise<void>;

/** Special column types handled with dedicated editors (not choice dropdowns). */
const SPECIAL_TYPES = new Set(['date']);

export async function renderTable(
	model: TableModel,
	getRegistry: () => ChoiceRegistry,
	container: HTMLElement,
	app: App,
	sourcePath: string,
	component: Component,
	onCellChange?: CellChangeHandler,
	onColTypeChange?: ColTypeChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): Promise<void> {
	if (model.columns.length === 0) return;

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
	const root = container.createDiv({ cls: 'bt-render-root' });
	const wrapper = root.createDiv({ cls: 'bt-table-wrapper' });
	const table = wrapper.createEl('table', { cls: 'bt-table' });

	// <colgroup> for precise column widths (required by table-layout:fixed).
	// Each contiguous run of hidden columns collapses to ONE narrow <col> so the
	// indicator cell (rendered once per group in renderRow) stays ~2 chars wide
	// instead of absorbing the table's leftover width.
	const HIDDEN_COL_WIDTH = 28;
	const colgroup = table.createEl('colgroup');
	const visibleCols: { colEl: HTMLElement; colIdx: number }[] = [];
	let totalWidth = 0;
	for (let ci = 0; ci < model.columns.length; ci++) {
		const col = model.columns[ci];
		if (col?.hidden) {
			// Skip the rest of this contiguous hidden group, emit one narrow <col>
			while (ci < model.columns.length && model.columns[ci]?.hidden) ci++;
			ci--; // loop will ++ again
			colgroup.createEl('col').style.setProperty('width', `${HIDDEN_COL_WIDTH}px`);
			totalWidth += HIDDEN_COL_WIDTH;
			continue;
		}
		if (!col) continue;
		const colEl = colgroup.createEl('col');
		const w = Math.max(colMinWidth(col, registry), col.width ?? 120);
		colEl.style.setProperty('width', `${w}px`);
		colEl.dataset.col = String(ci);
		totalWidth += w;
		visibleCols.push({ colEl, colIdx: ci });
	}
	// Pin the table to the exact sum of column widths (inline style beats any
	// theme `table { width: 100% }` rule). Without this, table-layout:fixed
	// distributes leftover width across all columns — bloating hidden-col cells.
	table.style.setProperty('width', `${totalWidth}px`);

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

		const rangeTarget = (r1 === r2 && c1 === c2)
			? `${colIndexToLetter(c1)}${r1 + 1}`
			: `${colIndexToLetter(c1)}${r1 + 1}:${colIndexToLetter(c2)}${r2 + 1}`;

		const anchor = selectedEls[selectedEls.length - 1] ?? table;
		const existingStyle = (() => {
			const s: { bg?: string; color?: string; size?: number } = {};
			for (const rule of model.styles) {
				if (!matchTarget(r1, c1, rule.target)) continue;
				if (rule.bg)   s.bg    = rule.bg;
				if (rule.color) s.color = rule.color;
				if (rule.size)  s.size  = rule.size;
			}
			return s;
		})();

		const isHeaderSel = r1 === 0 && r2 === 0;
		selectionPanel = openCellPanel({
			anchor,
			els: selectedEls,
			styleTarget: rangeTarget,
			existingStyle,
			showTextColor: true,
			cellOps: [
				{ icon: 'combine', label: t('mergeCells'),
					action: () => void onStructuralOp({ type: 'merge-cells', startRow: r1, startCol: c1, endRow: r2, endCol: c2 }) },
				// Row ops only for data selections (header row cannot be hidden/deleted)
				...(!isHeaderSel ? [
					{ icon: 'eye-off' as const, label: hideRowsLabel(r1, r2),
						action: () => { for (let ri = r1; ri <= r2; ri++) void onStructuralOp({ type: 'hide-row', rowIdx: ri }); } },
					{ icon: 'trash' as const, label: deleteRowsLabel(r1, r2), danger: true as const,
						action: () => { for (let ri = r2; ri >= r1; ri--) void onStructuralOp({ type: 'delete-row', rowIdx: ri }); } },
				] : []),
				{ icon: 'eye-off', label: hideColsLabel(c1, c2, colIndexToLetter),
					action: () => { for (let ci = c1; ci <= c2; ci++) void onStructuralOp({ type: 'hide-col', colIdx: ci }); } },
				{ icon: 'trash', label: deleteColsLabel(c1, c2, colIndexToLetter), danger: true,
					action: () => { for (let ci = c2; ci >= c1; ci--) void onStructuralOp({ type: 'delete-col', colIdx: ci }); } },
			],
			onApplyStyle: (bg, color, size) => void onStructuralOp({ type: 'set-range-style', target: rangeTarget, bg, color, size }),
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
		// Don't start merge selection when clicking a drag handle
		if ((evt.target as HTMLElement).closest('.bt-row-drag-handle')) return;
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
		if ((evt.target as HTMLElement).closest('.bt-col-drag-handle')) return;
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

	// ── Drag-and-drop row/column reordering ──────────────────────────────────
	if (onStructuralOp) {
		let dragOverRow = -1;
		let dragOverCol = -1;

		const clearDropIndicators = () => {
			table.querySelectorAll<HTMLElement>('.bt-drop-before').forEach(e => e.removeClass('bt-drop-before'));
			table.querySelectorAll<HTMLElement>('.bt-drop-after').forEach(e => e.removeClass('bt-drop-after'));
		};

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
				void onStructuralOp({ type: 'move-row', fromIdx, toIdx });
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
			th.addClass('bt-drop-before');
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
				void onStructuralOp({ type: 'move-col', fromIdx, toIdx });
			}
			dragOverCol = -1;
		});
	}
	const hiddenRows = new Set(model.hiddenRows ?? []);
	const visibleCellCount = countVisibleCells(model);
	let r = 1;
	while (r < model.rows.length) {
		if (hiddenRows.has(r)) {
			// Collect the contiguous hidden-row group
			const group: number[] = [];
			while (r < model.rows.length && hiddenRows.has(r)) group.push(r++);

			const indicatorTr = tbody.createEl('tr', { cls: 'bt-row-indicator' });
			indicatorTr.dataset.hiddenGroup = JSON.stringify(group);
			const td = indicatorTr.createEl('td', {
				cls: 'bt-row-indicator-cell',
				attr: { colspan: String(visibleCellCount) },
			});
			td.createSpan({ cls: 'bt-indicator-arrow', text: '▶' });
			td.createSpan({ cls: 'bt-indicator-label',
				text: ` ${group.length} hidden row${group.length > 1 ? 's' : ''}` });
			if (onStructuralOp) {
				td.addEventListener('click', () =>
					void onStructuralOp({ type: 'show-row-group', rowIndices: group }));
			}
			continue;
		}
		if (isRowFiltered(r, model)) { r++; continue; }
		const tr = tbody.createEl('tr');
		await renderRow(tr, r, model, occupied, registry, getRegistry, app, sourcePath, component, false, onCellChange, onColTypeChange, onStructuralOp);
		r++;
	}

	// TODO: filter status bar ("Showing X of Y rows · Clear filter") — deferred until
	// a unified table status bar is designed that can also host sort/aggregate info.

	// Footer
	if (model.footer) {
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
	let showEdgeStrips = () => { /* assigned in edge block */ };
	let hideEdgeStrips = () => { /* assigned in edge block */ };
	let showSelectors  = () => { /* assigned in selector block */ };
	let hideSelectors  = () => { /* assigned in selector block */ };

	// ── Edge-hover add strips (position:absolute inside bt-render-root) ──
	if (onStructuralOp) {
		const addRowBtn = root.createDiv({ cls: 'bt-edge-add-row' });
		addRowBtn.createSpan({ cls: 'bt-edge-plus', text: '+' });

		const addColBtn = root.createDiv({ cls: 'bt-edge-add-col' });
		addColBtn.createSpan({ cls: 'bt-edge-plus', text: '+' });

		addRowBtn.addEventListener('click', () =>
			void onStructuralOp({ type: 'insert-row', afterRowIdx: model.rows.length - 1 }));
		addColBtn.addEventListener('click', () =>
			void onStructuralOp({ type: 'insert-col', afterColIdx: model.columns.length - 1 }));

		// position:absolute — no viewport math, no scroll listeners needed.
		// Offsets are relative to bt-render-root, updated when table size changes.
		const positionStrips = () => {
			const tw = table.offsetWidth;
			const th = table.offsetHeight;
			const wl = wrapper.offsetLeft;
			const wt = wrapper.offsetTop;
			addRowBtn.setCssProps({
				'--strip-top':   `${wt + th + 2}px`,
				'--strip-left':  `${wl}px`,
				'--strip-width': `${tw}px`,
			});
			addColBtn.setCssProps({
				'--strip-top':    `${wt}px`,
				'--strip-left':   `${wl + tw + 2}px`,
				'--strip-height': `${th}px`,
			});
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
			cancelHide();
			positionStrips();
			addRowBtn.addClass('bt-strip-visible');
			addColBtn.addClass('bt-strip-visible');
		};
		hideEdgeStrips = scheduleHide;
		// No scroll listener needed — absolute positioning moves with the document flow.
	}

	// ── Row / column selector strips (Excel-style whole-row/column selection) ──
	if (onStructuralOp) {
		// Selectors are children of bt-render-root (position:absolute), so they are
		// naturally contained within Obsidian's content pane — no viewport math needed.
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
		model.rows.forEach((_row, ri) => {
			const h = rowSel.createDiv({ cls: 'bt-sel-resize-row', attr: { 'aria-hidden': 'true' } });
			bindResizeHandle(
				h, table, `data-row="${ri}"`, '--bt-row-height', 24,
				(height) => void onStructuralOp({ type: 'set-row-height', rowIdx: ri, height }),
				component,
				() => {
					// Reposition edge-add strips after row height changes
					const addRow = root.querySelector<HTMLElement>('.bt-edge-add-row.bt-strip-visible');
					const addCol = root.querySelector<HTMLElement>('.bt-edge-add-col.bt-strip-visible');
					if (addRow || addCol) {
						const tw = table.offsetWidth, th = table.offsetHeight;
						const wl = wrapper.offsetLeft, wt = wrapper.offsetTop;
						addRow?.setCssProps({ '--strip-top': `${wt + th + 2}px`, '--strip-left': `${wl}px`, '--strip-width': `${tw}px` });
						addCol?.setCssProps({ '--strip-top': `${wt}px`, '--strip-left': `${wl + tw + 2}px`, '--strip-height': `${th}px` });
					}
				},
			);
			h.addEventListener('dblclick', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				const fit = autoFitRowHeight(table, ri, 24);
				void onStructuralOp({ type: 'set-row-height', rowIdx: ri, height: fit });
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
			// Offsets relative to bt-render-root (the position:relative container).
			const wl = wrapper.offsetLeft;   // wrapper left edge within root
			const wt = wrapper.offsetTop;    // wrapper top edge within root
			const tw = table.offsetWidth;
			const th = table.offsetHeight;

			// Column selector — one cell per physical column from <col> geometry,
			// independent of any colspan merges in the header row.
			colSel.querySelectorAll('.bt-sel-cell').forEach(e => e.remove());
			colSel.setCssProps({ '--cs-top': `${wt - 22}px`, '--cs-left': `${wl}px`, '--cs-w': `${tw}px` });
			// Pre-index hidden-group indicators from the header by their left-edge x.
			const hiddenGroupByX = new Map<number, number[]>();
			let hiddenColX = 0;
			for (const c of Array.from(table.querySelectorAll<HTMLElement>('col'))) {
				const w = parseInt(c.style.width) || 0;
				if (c.dataset.col === undefined) {
					// Find matching bt-col-indicator in thead
					for (const th2 of Array.from(thead.querySelectorAll<HTMLElement>('th.bt-col-indicator[data-hidden-group]'))) {
						if (!hiddenGroupByX.has(Math.round(hiddenColX))) {
							const grp = JSON.parse(th2.dataset.hiddenGroup ?? '[]') as number[];
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
				} else {
					// Hidden column group — match by x position
					const group = hiddenGroupByX.get(Math.round(colX)) ?? [];
					const cell = colSel.createDiv({ cls: 'bt-sel-cell bt-sel-hidden' });
					cell.setAttribute('aria-label', `${group.length} hidden column${group.length > 1 ? 's' : ''} — click to show`);
					cell.setAttribute('data-tooltip-position', 'top');
					cell.setCssProps({ '--cl': `${colX}px`, '--cw': `${w}px` });
					if (group.length > 0) {
						const g = group;
						cell.addEventListener('click', () => void onStructuralOp({ type: 'show-col-group', colIndices: g }));
					}
				}
				colX += w;
			}

			// Row selector (left of table).
			// Remove only label cells; the persistent resize handles stay.
			rowSel.querySelectorAll('.bt-sel-cell').forEach(e => e.remove());
			rowSel.setCssProps({ '--rs-top': `${wt}px`, '--rs-left': `${wl - 22}px`, '--rs-h': `${th}px` });
			const allTrs = [
				...Array.from(thead.querySelectorAll<HTMLElement>('tr')),
				...Array.from(tbody.querySelectorAll<HTMLElement>('tr')),
			];
			// Row selector — one cell per physical row, independent of rowspan merges.
			for (const tr of allTrs) {
				if (!tr) continue;
				// offsetTop relative to the table element → add wt to get root offset
				const rowTop = tr.offsetTop;
				const rowH   = tr.offsetHeight;
				if (tr.hasClass('bt-row-indicator')) {
					const group = JSON.parse(tr.dataset.hiddenGroup ?? '[]') as number[];
					const cell = rowSel.createDiv({ cls: 'bt-sel-cell bt-sel-hidden' });
					cell.setAttribute('aria-label', `${group.length} hidden row${group.length > 1 ? 's' : ''} — click to show`);
					cell.setAttribute('data-tooltip-position', 'right');
					cell.setCssProps({ '--rt': `${rowTop}px`, '--rh': `${rowH}px` });
					cell.addEventListener('click', () => void onStructuralOp({ type: 'show-row-group', rowIndices: group }));
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
				const firstCell = table.querySelector<HTMLElement>(`[data-row="${ri}"]`);
				const tr = firstCell?.closest<HTMLElement>('tr');
				if (tr) {
					h.setCssProps({ '--ry': `${tr.offsetTop + tr.offsetHeight}px` });
					h.removeClass('bt-sel-resize-hidden');
				} else {
					h.addClass('bt-sel-resize-hidden');
				}
			}
		};

		let selHideTimer: number | null = null;
		const showSel = () => {
			if (selHideTimer) { window.clearTimeout(selHideTimer); selHideTimer = null; }
			rebuild();
			colSel.addClass('bt-strip-visible');
			rowSel.addClass('bt-strip-visible');
		};
		const scheduleSelHide = () => {
			if (selAxis !== null) return;
			if (selHideTimer) window.clearTimeout(selHideTimer);
			selHideTimer = window.setTimeout(() => {
				colSel.removeClass('bt-strip-visible');
				rowSel.removeClass('bt-strip-visible');
				selHideTimer = null;
			}, 80);
		};

		showSelectors = showSel;
		hideSelectors = scheduleSelHide;
		// Removed: scroll listener (position:absolute, no repositioning needed)

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
			const target = axis === 'col'
				? (lo === hi ? `${colIndexToLetter(lo)}*` : `${colIndexToLetter(lo)}:${colIndexToLetter(hi)}`)
				: `${lo + 1}:${hi + 1}`;

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
					action: () => { for (let ci = lo; ci <= hi; ci++) void onStructuralOp({ type: 'hide-col', colIdx: ci }); } },
				{ icon: 'trash',   label: deleteColsLabel(lo, hi, colIndexToLetter), danger: true,
					action: () => { for (let ci = hi; ci >= lo; ci--) void onStructuralOp({ type: 'delete-col', colIdx: ci }); } },
			] : lo === 0 && hi === 0 ? [] : [  // no hide/delete for header row
				{ icon: 'eye-off', label: hideRowsLabel(lo, hi),
					action: () => { for (let ri = lo; ri <= hi; ri++) void onStructuralOp({ type: 'hide-row', rowIdx: ri }); } },
				{ icon: 'trash',   label: deleteRowsLabel(lo, hi), danger: true,
					action: () => { for (let ri = hi; ri >= lo; ri--) void onStructuralOp({ type: 'delete-row', rowIdx: ri }); } },
			];

			// Keep selAxis/selI1/selI2 so highlights stay visible while the panel is open.
			// They are cleared in onClose so the highlight disappears when the panel closes.
			closeSelectorPanel();
			rebuild(); // re-render strip cells with is-sel, keep table highlights

			selectorPanel = openCellPanel({
				anchor, els,
				styleTarget: target,
				existingStyle: existing,
				inheritedStyle: {},
				showTextColor: true,
				cellOps,
				onApplyStyle: (bg, color, size) => void onStructuralOp({ type: 'set-range-style', target, bg, color, size }),
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

		// Column/row resize changes cell geometry → rebuild selector strip cells
		table.addEventListener('bt-layout-changed', () => {
			if (colSel.hasClass('bt-strip-visible') || rowSel.hasClass('bt-strip-visible')) rebuild();
		});
	}

	// ── Proximity-based reveal via the root container ─────────────────────────
	// Hovering the root container (which includes the selector/edge-add margin
	// areas) shows all overlays. No viewport math needed — just mouseenter/leave.
	if (onStructuralOp) {
		const NEAR_MARGIN = 34; // extra CSS padding on root exposes this hover zone
		root.setCssProps({ '--hover-margin': `${NEAR_MARGIN}px` });

		let wasNear = false;
		let proxRaf = 0;
		component.registerDomEvent(activeDocument, 'mousemove', (e: MouseEvent) => {
			const x = e.clientX, y = e.clientY;
			if (proxRaf) return;
			proxRaf = window.requestAnimationFrame(() => {
				proxRaf = 0;
				const r = root.getBoundingClientRect();
				const near = x >= r.left - NEAR_MARGIN && x <= r.right + NEAR_MARGIN &&
				             y >= r.top - NEAR_MARGIN && y <= r.bottom + NEAR_MARGIN;
				if (near && !wasNear) { showEdgeStrips(); showSelectors(); wasNear = true; }
				else if (!near && wasNear) { hideEdgeStrips(); hideSelectors(); wasNear = false; }
			});
		}, { passive: true });
	}
}

async function renderRow(
	tr: HTMLTableRowElement,
	rowIdx: number,
	model: TableModel,
	occupied: boolean[][],
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
	const rowCells   = model.rows[rowIdx] ?? [];
	const hiddenRows = new Set(model.hiddenRows ?? []);
	let c = 0;

	while (c < model.columns.length) {
		if (occupied[rowIdx]?.[c]) { c++; continue; }

		const col = model.columns[c];
		if (!col) { c++; continue; }

		// Hidden column group — render a single narrow indicator cell
		if (col.hidden) {
			const group: number[] = [];
			while (c < model.columns.length && model.columns[c]?.hidden) group.push(c++);

			const tag       = isHeader ? 'th' : 'td';
			const indicator = tr.createEl(tag, { cls: 'bt-col-indicator' });

			if (isHeader) {
				const label = `${group.length}`;
				indicator.createSpan({ cls: 'bt-indicator-arrow', text: '▶' });
				indicator.createSpan({ cls: 'bt-indicator-count', text: label });
				indicator.setAttribute('aria-label',
					`${group.length} hidden column${group.length > 1 ? 's' : ''}. Click to show.`);
				indicator.setAttribute('data-tooltip-position', 'top');
				indicator.dataset.hiddenGroup = JSON.stringify(group); // for selector strip
				if (onStructuralOp) {
					indicator.addEventListener('click', () =>
						void onStructuralOp({ type: 'show-col-group', colIndices: group }));
				}
			}
			continue;
		}

		// Normal cell — snapshot c so closures below capture the right column index
		const colIdx = c;
		const isFirstVisible = !isHeader && c === (model.columns.findIndex(col2 => !col2?.hidden));
		const merge = getMergeOrigin(rowIdx, colIdx, model.merges);
		const tag   = isHeader ? 'th' : 'td';
		const el    = tr.createEl(tag, { cls: isHeader ? 'bt-th' : 'bt-td' });
		el.dataset.row = String(rowIdx);
		el.dataset.col = String(colIdx);

		if (merge) {
			// Adjust rowspan/colspan to skip hidden rows/cols within the merge
			let rowSpan = 0;
			for (let ri = merge.startRow; ri <= merge.endRow; ri++) {
				if (!hiddenRows.has(ri)) rowSpan++;
			}
			let colSpan = 0;
			for (let ci = merge.startCol; ci <= merge.endCol; ci++) {
				if (!model.columns[ci]?.hidden) colSpan++;
			}
			if (rowSpan > 1) el.rowSpan = rowSpan;
			if (colSpan > 1) el.colSpan = colSpan;
		}

		applyColStyle(el, col);
		applyStyleRules(el, rowIdx, colIdx, model.styles);
		// Apply stored row height (height on td acts as minimum row height)
		const rh = model.rowHeights?.[rowIdx];
		if (rh) el.style.setProperty('--bt-row-height', `${rh}px`);
		else el.style.removeProperty('--bt-row-height');

		const value = rowCells[colIdx] ?? '';

		// ── Drag-reorder handles ─────────────────────────────────────────────
		if (onStructuralOp) {
			const makeDots = (parent: HTMLElement) => setIcon(parent, 'grip-vertical');
			if (isHeader) {
				// Column drag handle: top-center of header cell, cursor:grab
				const cdh = el.createDiv({
					cls: 'bt-col-drag-handle',
					attr: { draggable: 'true', 'aria-label': t('dragReorderCol') },
				});
				makeDots(cdh);
				cdh.addEventListener('dragstart', (evt: DragEvent) => {
					evt.dataTransfer?.setData('bt-drag-col', String(colIdx));
					el.addClass('bt-dragging');
				});
				cdh.addEventListener('dragend', () => el.removeClass('bt-dragging'));
			} else if (isFirstVisible) {
				// Row drag handle: left-center of first visible data cell
				const rdh = el.createDiv({
					cls: 'bt-row-drag-handle',
					attr: { draggable: 'true', 'aria-label': t('dragReorderRow') },
				});
				makeDots(rdh);
				rdh.addEventListener('dragstart', (evt: DragEvent) => {
					evt.dataTransfer?.setData('bt-drag-row', String(rowIdx));
					el.addClass('bt-dragging');
				});
				rdh.addEventListener('dragend', () => el.removeClass('bt-dragging'));
			}
		}

		if (isHeader) {
			renderHeaderCell(el, value, col, colIdx, getRegistry, app, sourcePath, model, component, onCellChange, onColTypeChange, onStructuralOp);
		} else {
			await renderDataCell(el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model, onCellChange, onStructuralOp);
			// Row-height resize is handled by the selector-strip handles (works with merges too)
		}
		c++;
	}
}

function renderHeaderCell(
	el: HTMLElement,
	value: string,
	col: ColumnDef,
	colIdx: number,
	getRegistry: () => ChoiceRegistry,
	app: App,
	sourcePath: string,
	model: TableModel,
	component: Component,
	onCellChange?: CellChangeHandler,
	onColTypeChange?: ColTypeChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): void {
	el.createSpan({ cls: 'bt-th-text', text: value });
	if (col.type) el.addClass('bt-th-typed');

	const openPanel = (evt: MouseEvent) => {
		if (!onStructuralOp && !onColTypeChange) return;
		const ops: CellOpDef[] = [];
		if (onStructuralOp) {
			ops.push(
				{ icon: 'arrow-down',  label: t('insertRowBelow'),  action: () => void onStructuralOp({ type: 'insert-row', afterRowIdx: 0 }) },
				{ icon: 'arrow-left',  label: t('insertColBefore'), action: () => void onStructuralOp({ type: 'insert-col', afterColIdx: colIdx - 1 }) },
				{ icon: 'arrow-right', label: t('insertColAfter'),  action: () => void onStructuralOp({ type: 'insert-col', afterColIdx: colIdx }) },
				{ icon: 'eye-off',     label: t('hideColumn'),      action: () => void onStructuralOp({ type: 'hide-col', colIdx }) },
				{ icon: 'trash',       label: t('deleteColumn'), danger: true, action: () => void onStructuralOp({ type: 'delete-col', colIdx }) },
			);
		}
		openCellPanel({
			anchor: el,
			els: [el],
			styleTarget: colIndexToLetter(colIdx) + '1',
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
				? (bg, color, size) => void onStructuralOp({ type: 'set-cell-style', rowIdx: 0, colIdx, bg, color, size })
				: () => { /* no-op */ },
		});
	};

	el.addEventListener('contextmenu', (evt: MouseEvent) => { evt.preventDefault(); openPanel(evt); });
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
			if (evt.detail >= 2 && editTimer !== null) { window.clearTimeout(editTimer); editTimer = null; }
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
		openPanel(evt);
	});

	// Filter button — bottom-right corner of the header cell
	if (onStructuralOp) {
		const colLetter = colIndexToLetter(colIdx);
		const activeValues = model.filter?.[colLetter];
		const filterBtn = el.createDiv({
			cls: 'bt-filter-btn' + (activeValues ? ' bt-filter-active' : ''),
			attr: { 'aria-label': t('filterColumn'), 'data-tooltip-position': 'top' },
		});
		setIcon(filterBtn, 'filter');
		filterBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			openFilterPanel(el, colIdx, colLetter, model, getRegistry(), onStructuralOp);
		});
	}
	// Column resize is handled by the selector-strip handles (works with merges too)
}

async function renderDataCell(
	el: HTMLElement,
	value: string,
	col: ColumnDef,
	rowIdx: number,
	colIdx: number,
	registry: ChoiceRegistry,
	app: App,
	sourcePath: string,
	component: Component,
	model: TableModel,
	onCellChange?: CellChangeHandler,
	onStructuralOp?: StructuralOpHandler,
): Promise<void> {
	const trimmed = value.trim();

	// Special type: date picker
	if (col.type === 'date') {
		renderDateCell(el, trimmed, rowIdx, colIdx, model, onCellChange, onStructuralOp);
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
				openCellPanel({
					anchor: el, els: [el],
					styleTarget: colIndexToLetter(colIdx) + (rowIdx + 1),
					existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
				inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx),
					showTextColor: !!getMergeOrigin(rowIdx, colIdx, model.merges),
					cellOps: ops,
					onApplyStyle: (bg, color, size) => void onStructuralOp({ type: 'set-cell-style', rowIdx, colIdx, bg, color, size }),
				});
			});
		}
		return;
	}

	if (trimmed) {
		await MarkdownRenderer.render(app, trimmed, el, sourcePath, component);
	}

	if (onCellChange) {
		el.addClass('bt-td-editable');

		// Single click (200 ms delay) → text editor; double click → style panel.
		// The delay lets mousedown.detail detect a double-click before the edit opens.
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
			openCellPanel({
				anchor: el, els: [el],
				styleTarget: colIndexToLetter(colIdx) + (rowIdx + 1),
				existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
				inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx),
				showTextColor: true,
				cellOps: ops,
				onApplyStyle: (bg, color, size) => void onStructuralOp({ type: 'set-cell-style', rowIdx, colIdx, bg, color, size }),
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
	model: TableModel,
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
			openCellPanel({
				anchor: el, els: [el],
				styleTarget: colIndexToLetter(colIdx) + (rowIdx + 1),
				existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
				inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx),
				showTextColor: true,
				cellOps: ops,
				onApplyStyle: (bg, color, size) => void onStructuralOp({ type: 'set-cell-style', rowIdx, colIdx, bg, color, size }),
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
	anchor:          HTMLElement;
	els:             HTMLElement[];
	styleTarget:     string;
	existingStyle:   { bg?: string; color?: string; size?: number };
	inheritedStyle?: { bg?: string; color?: string; size?: number };
	showTextColor:   boolean;
	cellOps:       CellOpDef[];
	typeSection?:  {
		colIdx:          number;
		currentType?:    string;
		getRegistry:     () => ChoiceRegistry;
		onColTypeChange: ColTypeChangeHandler;
	};
	onApplyStyle: (bg: string | null, color: string | null, size: number | null) => void;
	onClose?:     () => void;
}

/** Effective style of a cell: last-wins aggregation of all matching style rules. */
function cellEffectiveStyle(
	model: TableModel, rowIdx: number, colIdx: number,
): { bg?: string; color?: string; size?: number } {
	const r: { bg?: string; color?: string; size?: number } = {};
	for (const rule of model.styles) {
		if (!matchTarget(rowIdx, colIdx, rule.target)) continue;
		if (rule.bg)    r.bg    = rule.bg;
		if (rule.color) r.color = rule.color;
		if (rule.size)  r.size  = rule.size;
	}
	return r;
}

/**
 * Style that a cell inherits from non-exact rules (rows, columns, ranges).
 * Excludes any rule whose target matches this cell exactly (e.g. "B2").
 * Used as the preview fallback when a panel checkbox is unchecked: the result
 * after clearing the cell-specific override is this inherited value, not the
 * theme default — so preview stays consistent with what Apply actually produces.
 */
function cellInheritedStyle(
	model: TableModel, rowIdx: number, colIdx: number,
): { bg?: string; color?: string; size?: number } {
	const exactTarget = `${colIndexToLetter(colIdx)}${rowIdx + 1}`;
	const r: { bg?: string; color?: string; size?: number } = {};
	for (const rule of model.styles) {
		if (rule.target === exactTarget) continue;
		if (!matchTarget(rowIdx, colIdx, rule.target)) continue;
		if (rule.bg)    r.bg    = rule.bg;
		if (rule.color) r.color = rule.color;
		if (rule.size)  r.size  = rule.size;
	}
	return r;
}

/** Standard cell-op buttons for a data cell (row/col insert/delete/hide + optional unmerge).
 *  For merged cells, delete/hide/insert operations span the full merge range. */
function dataCellOps(
	rowIdx: number, colIdx: number,
	model: TableModel, onStructuralOp: StructuralOpHandler,
): CellOpDef[] {
	const ops: CellOpDef[] = [];
	const merge = getMergeOrigin(rowIdx, colIdx, model.merges);
	if (merge && (merge.endRow > merge.startRow || merge.endCol > merge.startCol)) {
		ops.push({ icon: 'table-2', label: t('unmergeCells'),
			action: () => void onStructuralOp({ type: 'unmerge-cells', startRow: merge.startRow, startCol: merge.startCol }) });
	}

	const r1 = merge?.startRow ?? rowIdx;
	const r2 = merge?.endRow   ?? rowIdx;
	const c1 = merge?.startCol ?? colIdx;
	const c2 = merge?.endCol   ?? colIdx;

	ops.push(
		{ icon: 'arrow-up',    label: t('insertRowAbove'),  action: () => void onStructuralOp({ type: 'insert-row', afterRowIdx: r1 - 1 }) },
		{ icon: 'arrow-down',  label: t('insertRowBelow'),  action: () => void onStructuralOp({ type: 'insert-row', afterRowIdx: r2 }) },
		{ icon: 'arrow-left',  label: t('insertColBefore'), action: () => void onStructuralOp({ type: 'insert-col', afterColIdx: c1 - 1 }) },
		{ icon: 'arrow-right', label: t('insertColAfter'),  action: () => void onStructuralOp({ type: 'insert-col', afterColIdx: c2 }) },
		{ icon: 'eye-off', label: hideRowsLabel(r1, r2),
			action: () => { for (let r = r1; r <= r2; r++) void onStructuralOp({ type: 'hide-row', rowIdx: r }); } },
		{ icon: 'eye-off', label: hideColsLabel(c1, c2, colIndexToLetter),
			action: () => { for (let c = c1; c <= c2; c++) void onStructuralOp({ type: 'hide-col', colIdx: c }); } },
		{ icon: 'trash', label: deleteRowsLabel(r1, r2), danger: true,
			action: () => { for (let r = r2; r >= r1; r--) void onStructuralOp({ type: 'delete-row', rowIdx: r }); } },
		{ icon: 'trash', label: deleteColsLabel(c1, c2, colIndexToLetter), danger: true,
			action: () => { for (let c = c2; c >= c1; c--) void onStructuralOp({ type: 'delete-col', colIdx: c }); } },
	);
	return ops;
}

// Module-level reference so any new openCellPanel call can close the previous one first.
let closeActivePanel: (() => void) | null = null;

/** Filter dropdown panel for a column. */
function openFilterPanel(
	anchor: HTMLElement,
	colIdx: number,
	colLetter: string,
	model: TableModel,
	registry: ChoiceRegistry,
	onStructuralOp: StructuralOpHandler,
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
		for (let ri = 1; ri < model.rows.length; ri++) {
			const v = model.rows[ri]?.[colIdx]?.trim() ?? '';
			if (v && !seen.has(v)) { seen.add(v); defined.push({ value: v, label: v }); }
		}
		defined.sort((a, b) => a.label.localeCompare(b.label));
	}

	const current = new Set(model.filter?.[colLetter] ?? []);
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
	const close = () => {
		if (!committed) committed = true;
		panel.remove();
		if (closeActivePanel === doClose) closeActivePanel = null;
	};
	const doClose = close;
	closeActivePanel = doClose;

	clearBtn.addEventListener('click', () => {
		committed = true;
		void onStructuralOp({ type: 'set-filter', colLetter, values: null });
		close();
	});
	applyBtn.addEventListener('click', () => {
		committed = true;
		const selected = checkboxes.filter(c => c.chk.checked).map(c => c.value);
		const allSelected = selected.length === checkboxes.length;
		void onStructuralOp({ type: 'set-filter', colLetter, values: allSelected ? null : selected });
		close();
	});
	panel.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') { e.stopPropagation(); close(); }
		if (e.key === 'Enter')  { e.preventDefault(); applyBtn.click(); }
	});
	window.setTimeout(() => {
		const outside = (e: MouseEvent) => {
			if (!panel.contains(e.target as Node)) { close(); activeDocument.removeEventListener('mousedown', outside); }
		};
		activeDocument.addEventListener('mousedown', outside);
	}, 0);
}

/** Unified panel shown on double-click for all cell types (header / data / selection). */
function openCellPanel(config: CellPanelConfig): HTMLElement {
	// Close any panel that is currently open (restores preview styles on the old cells).
	closeActivePanel?.();

	const { anchor, els, existingStyle, inheritedStyle = {}, showTextColor, cellOps, typeSection, onApplyStyle } = config;

	const saved = els.map(e => ({
		bg:       e.style.getPropertyValue('background-color'),
		color:    e.style.getPropertyValue('color'),
		size:     e.style.getPropertyValue('font-size'),
		sizeVar:  e.style.getPropertyValue('--bt-cell-font-size'),
	}));
	const restoreEls = () => els.forEach((e, i) => {
		const s = saved[i];
		if (!s) return;
		if (s.bg)      e.style.setProperty('background-color', s.bg);          else e.style.removeProperty('background-color');
		if (s.color)   e.style.setProperty('color', s.color);                  else e.style.removeProperty('color');
		if (s.size)    e.style.setProperty('font-size', s.size);               else e.style.removeProperty('font-size');
		if (s.sizeVar) e.style.setProperty('--bt-cell-font-size', s.sizeVar);  else e.style.removeProperty('--bt-cell-font-size');
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

	const styleFoot = styleEl.createDiv({ cls: 'bt-cp-style-footer' });
	const clearBtn  = styleFoot.createEl('button', { cls: 'bt-sp-clear-btn', text: t('clearFormat') });
	const applyBtn  = styleFoot.createEl('button', { cls: 'bt-sp-apply',     text: t('apply') });

	const preview = () => {
		// When a checkbox is unchecked, fall back to the inherited value rather than
		// removing the property. This matches what applyStyleRules produces after Apply:
		// clearing a cell-specific rule doesn't suppress broader rules (1:1, B*, etc.).
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
		}
	};
	bgEnable.addEventListener('change', () => { bgPicker.disabled = !bgEnable.checked; preview(); });
	bgPicker.addEventListener('input', preview);
	colorEnable?.addEventListener('change', () => { if (colorPicker) colorPicker.disabled = !colorEnable?.checked; preview(); });
	colorPicker?.addEventListener('input', preview);
	sizeInput.addEventListener('input', preview);

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
	const close = (restore: boolean) => {
		if (!committed) { if (restore) restoreEls(); committed = true; }
		panel.remove();
		if (closeActivePanel === thisClose) closeActivePanel = null;
		config.onClose?.();
	};
	const thisClose = () => close(true);
	closeActivePanel = thisClose;
	clearBtn.addEventListener('click', () => { committed = true; onApplyStyle(null, null, null); panel.remove(); config.onClose?.(); });
	applyBtn.addEventListener('click', () => {
		committed = true;
		onApplyStyle(
			bgEnable.checked ? bgPicker.value : null,
			colorEnable?.checked ? (colorPicker?.value ?? null) : null,
			sizeInput.value.trim() ? parseInt(sizeInput.value.trim(), 10) : null,
		);
		panel.remove(); config.onClose?.();
	});
	// Enter in the panel (not in size input) confirms; handled here for when a
	// panel control has focus.
	panel.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' && evt.target !== sizeInput) { evt.preventDefault(); applyBtn.click(); }
	});
	// Escape and outside-click close the panel regardless of where focus is.
	window.setTimeout(() => {
		const outside = (evt: MouseEvent) => {
			if (!panel.contains(evt.target as Node)) {
				close(true);
				activeDocument.removeEventListener('mousedown', outside);
				activeDocument.removeEventListener('keydown', escKey);
			}
		};
		const escKey = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				evt.stopPropagation();
				close(true);
				activeDocument.removeEventListener('keydown', escKey);
				activeDocument.removeEventListener('mousedown', outside);
			}
		};
		activeDocument.addEventListener('mousedown', outside);
		activeDocument.addEventListener('keydown', escKey);
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

/** Returns true when rowIdx (0-indexed data row ≥ 1) should be hidden by active filters. */
function isRowFiltered(rowIdx: number, model: TableModel): boolean {
	if (!model.filter || rowIdx === 0) return false;
	for (const [colLetter, values] of Object.entries(model.filter)) {
		if (!values || values.length === 0) continue;
		const ci = colLetterToIndex(colLetter);
		const cellValue = model.rows[rowIdx]?.[ci]?.trim() ?? '';
		if (!values.includes(cellValue)) return true;
	}
	return false;
}

function applyColStyle(el: HTMLElement, col: ColumnDef): void {
	// Width is now controlled solely by <colgroup>/<col> — no CSS variable needed
	if (col.align) el.addClass(`bt-align-${col.align}`);
}

/**
 * Minimum column width based on content.
 * For typed columns the widest option label determines the minimum so choice
 * pills are never cut off.  Uses ~8px per character + 24px padding/chrome.
 */
function colMinWidth(col: ColumnDef, registry: ChoiceRegistry): number {
	const base = 40;
	if (!col.type || SPECIAL_TYPES.has(col.type)) return base;
	const ct = registry.get(col.type);
	if (!ct || ct.options.length === 0) return base;
	const maxLen = Math.max(...ct.options.map(o => (o.label ?? o.value).length));
	return Math.max(base, maxLen * 8 + 24);
}

/**
 * Auto-fit a column's width to the widest content among its cells.
 * Clones each cell into an off-screen auto-layout table with white-space:nowrap
 * so the browser reports each cell's intrinsic single-line width; returns the max.
 */
function autoFitColWidth(tbl: HTMLElement, colIdx: number, minW: number): number {
	const cells = Array.from(tbl.querySelectorAll<HTMLElement>(`[data-col="${colIdx}"]`));
	if (cells.length === 0) return minW;

	let max = minW;
	for (const cell of cells) {
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
		//    elements — useless. The inline span's offsetWidth is the actual text width.
		const textSpan = cell.querySelector<HTMLElement>('.bt-th-text');
		if (textSpan) {
			max = Math.max(max, textSpan.offsetWidth + padH + borderH);
			continue;
		}

		// 3. Data cell with text: use a Range to get the rendered text width.
		//    getBoundingClientRect on a Range gives the tightest bounding box of the
		//    selected content — unlike cell.scrollWidth it doesn't equal the cell width.
		const text = cell.textContent?.trim() ?? '';
		if (text) {
			const range = activeDocument.createRange();
			range.selectNodeContents(cell);
			const rw = range.getBoundingClientRect().width;
			if (rw > 0) max = Math.max(max, rw + padH + borderH);
		}
		// Empty data cell: skip — its scrollWidth == current cell width,
		// using it would cause the column to grow on every double-click.
	}
	return Math.ceil(max);
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
	model: TableModel,
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
		void onStructuralOp({ type: 'set-col-width', colIdx, width: fit });
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
				const nextMIN = nextColIdx >= 0
					? colMinWidth(model.columns[nextColIdx] ?? { name: '' }, getRegistry())
					: 40;
				nextCol.style.setProperty('width', `${Math.max(nextMIN, startNextW - delta)}px`);
			}
			const sum = Array.from(tbl.querySelectorAll<HTMLElement>('col'))
				.reduce((s, c) => s + (parseInt(c.style.width) || 0), 0);
			tbl.style.setProperty('width', `${sum}px`);

			if (colLine) colLine.setCssProps({ '--ri-x': `${colRightX(tbl, colIdx)}px` });
			// Reposition edge-add strips (root-relative coords, no getBoundingClientRect needed)
			const addRow = tbl.closest<HTMLElement>('.bt-render-root')
				?.querySelector<HTMLElement>('.bt-edge-add-row.bt-strip-visible');
			const addCol = tbl.closest<HTMLElement>('.bt-render-root')
				?.querySelector<HTMLElement>('.bt-edge-add-col.bt-strip-visible');
			if (addRow || addCol) {
				const wl2 = tbl.closest<HTMLElement>('.bt-table-wrapper')?.offsetLeft ?? 0;
				const wt2 = tbl.closest<HTMLElement>('.bt-table-wrapper')?.offsetTop  ?? 0;
				const tw2 = tbl.offsetWidth, th2 = tbl.offsetHeight;
				addRow?.setCssProps({ '--strip-top': `${wt2 + th2 + 2}px`, '--strip-left': `${wl2}px`, '--strip-width': `${tw2}px` });
				addCol?.setCssProps({ '--strip-top': `${wt2}px`, '--strip-left': `${wl2 + tw2 + 2}px`, '--strip-height': `${th2}px` });
			}
			tbl.dispatchEvent(new CustomEvent('bt-layout-changed'));
		};

		const onUp = (ev: PointerEvent) => {
			handle.removeEventListener('pointermove', onMove);
			colDragging = false;
			hideColLine();
			const delta = ev.clientX - startX;
			if (delta === 0) return;
			void onStructuralOp({ type: 'set-col-width', colIdx, width: Math.max(MIN, startW + delta) });
			if (nextCol && startNextW !== null && nextColIdx >= 0) {
				const nextMIN = colMinWidth(model.columns[nextColIdx] ?? { name: '' }, getRegistry());
				void onStructuralOp({ type: 'set-col-width', colIdx: nextColIdx, width: Math.max(nextMIN, startNextW - delta) });
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
	// Temporarily clear the forced height so cells collapse to content, measure, restore.
	const saved = cells.map(c => c.style.getPropertyValue('--bt-row-height'));
	cells.forEach(c => c.style.removeProperty('--bt-row-height'));
	let max = minH;
	for (const c of cells) max = Math.max(max, c.offsetHeight);
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

function applyStyleRules(el: HTMLElement, row: number, col: number, styles: StyleRule[]): void {
	for (const rule of styles) {
		if (!matchTarget(row, col, rule.target)) continue;
		// Set bg/color as inline styles so they beat any theme stylesheet rule
		if (rule.bg)    el.style.setProperty('background-color', rule.bg);
		if (rule.color) el.style.setProperty('color', rule.color);
		if (rule.size) {
			el.style.setProperty('font-size', `${rule.size}px`);
			// Expose as CSS variable so .bt-choice pills (which have their own
			// font-size declaration) can also pick up the override via the cascade.
			el.style.setProperty('--bt-cell-font-size', `${rule.size}px`);
		}
		if (rule.bold)   el.addClass('bt-bold');
		if (rule.italic) el.addClass('bt-italic');
	}
}

function matchTarget(row: number, col: number, target: string): boolean {
	const colWild = /^([A-Z]+)\*$/.exec(target);
	if (colWild) {
		const letter = colWild[1];
		if (letter !== undefined) return colLetterToIndex(letter) === col;
	}

	const rowWild = /^\*(\d+)$/.exec(target);
	if (rowWild) {
		const n = rowWild[1];
		if (n !== undefined) return parseInt(n) - 1 === row;
	}

	const rowRange = /^(\d+):(\d+)$/.exec(target);
	if (rowRange) {
		const n1 = rowRange[1], n2 = rowRange[2];
		if (n1 !== undefined && n2 !== undefined) {
			return row >= parseInt(n1) - 1 && row <= parseInt(n2) - 1;
		}
	}

	// A:B → column range (all rows in columns A through B)
	const colRange = /^([A-Z]+):([A-Z]+)$/.exec(target);
	if (colRange) {
		const letter1 = colRange[1], letter2 = colRange[2];
		if (letter1 !== undefined && letter2 !== undefined) {
			const c1 = colLetterToIndex(letter1);
			const c2 = colLetterToIndex(letter2);
			return col >= Math.min(c1, c2) && col <= Math.max(c1, c2);
		}
	}

	const cellRange = /^([A-Z]+\d+):([A-Z]+\d+)$/.exec(target);
	if (cellRange) {
		const c1 = cellRange[1], c2 = cellRange[2];
		if (c1 !== undefined && c2 !== undefined) {
			const s = parseCellCoord(c1);
			const e = parseCellCoord(c2);
			if (s && e) {
				return row >= s.row && row <= e.row && col >= s.col && col <= e.col;
			}
		}
	}

	const single = /^([A-Z]+)(\d+)$/.exec(target);
	if (single) {
		const letter = single[1], numStr = single[2];
		if (letter !== undefined && numStr !== undefined) {
			return colLetterToIndex(letter) === col && parseInt(numStr) - 1 === row;
		}
	}

	return false;
}

function buildOccupied(model: TableModel): boolean[][] {
	const numRows    = model.rows.length;
	const numCols    = model.columns.length;
	const hiddenRows = new Set(model.hiddenRows ?? []);
	const grid: boolean[][] = Array.from({ length: numRows }, () =>
		new Array(numCols).fill(false) as boolean[],
	);
	for (const m of model.merges) {
		// If the merge origin is hidden, don't mark any cells as occupied —
		// the covered cells should render as normal cells instead.
		if (hiddenRows.has(m.startRow) || model.columns[m.startCol]?.hidden) continue;

		for (let r = m.startRow; r <= Math.min(m.endRow, numRows - 1); r++) {
			for (let c = m.startCol; c <= Math.min(m.endCol, numCols - 1); c++) {
				if (r === m.startRow && c === m.startCol) continue;
				(grid[r] as boolean[])[c] = true;
			}
		}
	}
	return grid;
}

/** Number of visible cells per row (visible cols + one indicator per hidden group). */
function countVisibleCells(model: TableModel): number {
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

function getMergeOrigin(row: number, col: number, merges: MergeRange[]): MergeRange | undefined {
	return merges.find(m => m.startRow === row && m.startCol === col);
}
