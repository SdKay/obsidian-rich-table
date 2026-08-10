import { App, Component, MarkdownRenderer, Menu, setIcon } from 'obsidian';
import { t, sortActiveLabel } from './i18n';
import type { ColumnDefV2, TableModelV2 } from './model';
import type { FormulaErrorCode } from './formula';
import type { ChoiceRegistry } from './choiceRegistry';
import type { CellChangeHandler, ColTypeChangeHandler, StructuralOpHandler, EditNavigateHandler } from './renderTypes';
import { rowId, colId, getMergeOrigin } from './renderGridHelpers';
import {
	cellEffectiveStyle, cellInheritedStyle, buildCellStyleContext,
	applyColStyle, applyStyleRulesV2,
} from './renderCellStyle';
import { copyRangeToClipboard, copyRangeAsMarkdown } from './renderClipboard';
import { enterDateEditMode, enterEditMode, type FormulaEditHooks } from './renderEditMode';
import { idFormulaToLabel } from './formulaLabel';
import { type CellOpEntry, dataCellOps, openFilterPanel, openCellPanel } from './renderPanel';
import { showMenuPinned } from './renderHoverPin';
import { takeLiveEdit } from './renderEditHandoff';

/**
 * Single source of truth for a cell's click→primary-action / panel-action wiring,
 * shared by header / text / date / choice cells (which differ only in what the
 * "primary action" is — enter text edit, open date picker, or open the choice
 * menu — and the double-vs-single disambiguation delay).
 *
 * Two modes, chosen fresh on every click via `getSingleClickEdit()` (so toggling
 * the setting takes effect on already-rendered tables without a re-render):
 *  - classic (returns false): single click waits `delayMs` (to rule out a
 *    double-click) then runs the primary action; double click opens the panel.
 *  - single-click-edit (returns true): single click runs the primary action
 *    immediately; Ctrl/Cmd+click opens the panel (double-click does nothing,
 *    since its first click already fired the primary action).
 */
const primaryActions = new WeakMap<HTMLElement, (evt: MouseEvent, seedChar?: string) => void>();

export function bindCellActivation(el: HTMLElement, opts: {
	getSingleClickEdit: () => boolean;
	delayMs: number;
	primaryAction: (evt: MouseEvent, seedChar?: string) => void;
	panelAction: (evt: MouseEvent) => void;
	/** Skip the click entirely (e.g. clicked an internal link, or a drag just ended). */
	shouldSkip?: (evt: MouseEvent) => boolean;
}): void {
	primaryActions.set(el, opts.primaryAction);
	const isEditing = () => el.hasClass('bt-editing');
	let timer: number | null = null;
	el.addEventListener('mousedown', (evt: MouseEvent) => {
		// A double-click's first mousedown(detail=1) armed the timer; its second
		// mousedown(detail>=2) cancels it so classic mode goes to the panel, not edit.
		if (evt.detail >= 2 && timer !== null) { window.clearTimeout(timer); timer = null; }
	});
	el.addEventListener('click', (evt: MouseEvent) => {
		if (isEditing()) return;
		if (opts.shouldSkip?.(evt)) return;
		if (evt.detail >= 2) return;
		if (opts.getSingleClickEdit()) {
			if (evt.ctrlKey || evt.metaKey) opts.panelAction(evt);
			else opts.primaryAction(evt);
			return;
		}
		if (timer !== null) return;
		const saved = evt;
		timer = window.setTimeout(() => { timer = null; opts.primaryAction(saved); }, opts.delayMs);
	});
	el.addEventListener('dblclick', (evt: MouseEvent) => {
		if (isEditing()) return;
		if (opts.getSingleClickEdit()) return; // panel is Ctrl/Cmd+click in this mode
		opts.panelAction(evt);
	});
}

/**
 * Runs whatever bindCellActivation registered as this cell's primary action —
 * the same closure a real click ends up calling — so keyboard activation
 * (Enter, or typing while a cell is Selected) opens exactly the editor/menu that
 * cell type uses, with no duplicate per-type dispatch to keep in sync here.
 *
 * The click/double-click disambiguation delay is skipped deliberately: there is
 * no "double Enter" to wait for. The synthesized event carries the cell's own
 * corner coordinates, matching the existing Enter-key precedent further down
 * this file, so a primaryAction that positions a popup off `clientX/clientY`
 * still lands on the right cell.
 *
 * `seedChar` reaches whichever primaryAction takes it — currently text and
 * header cells, which forward it to enterEditMode's `initialText` so typing on a
 * Selected cell replaces the content with that character instead of keeping it.
 * Returns false when the cell has no primary action bound (a read-only cell, or
 * one whose column has no onCellChange).
 */
export function triggerPrimaryAction(el: HTMLElement, seedChar?: string): boolean {
	const fn = primaryActions.get(el);
	if (!fn) return false;
	const r = el.getBoundingClientRect();
	fn(new MouseEvent('click', { clientX: r.left, clientY: r.bottom }), seedChar);
	return true;
}

export interface RenderRowOptions {
	tr:              HTMLTableRowElement;
	rowIdx:          number; // 0 = header, 1+ = data rows (1-based)
	model:           TableModelV2;
	occupied:        Set<string>;
	registry:        ChoiceRegistry;
	getRegistry:     () => ChoiceRegistry;
	app:             App;
	sourcePath:      string;
	component:       Component;
	isHeader:        boolean;
	onCellChange?:    CellChangeHandler;
	onColTypeChange?: ColTypeChangeHandler;
	onStructuralOp?:  StructuralOpHandler;
	/** Table identity for renderEditHandoff.ts's cross-rebuild edit resume — see that
	 *  file for why a write-back-triggered rebuild needs this instead of just DOM refs. */
	cacheKey?:       string;
	/** Single-click enters edit immediately; Ctrl/Cmd+click opens the style panel. */
	getSingleClickEdit?: () => boolean;
	/** How a closing editor hands control back to keyboard navigation — see the
	 *  type's own doc comment, and renderer.ts for where 'next'/'prev' resolve. */
	onEditNavigate?: EditNavigateHandler;
	/** Formula-mode hooks — see FormulaEditHooks's own doc comment. Only
	 *  meaningful for plain untyped columns; threaded through unconditionally
	 *  since renderDataCell is what actually gates on `!col.type`. */
	onEnterFormulaMode?: (insertText: (label: string) => void) => void;
	onExitFormulaMode?: () => void;
}

export async function renderRow(options: RenderRowOptions): Promise<void> {
	const {
		tr, rowIdx, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader,
		onCellChange, onColTypeChange, onStructuralOp, cacheKey, getSingleClickEdit, onEditNavigate,
		onEnterFormulaMode, onExitFormulaMode,
	} = options;
	const currentRow = rowIdx > 0 ? (model.rows[rowIdx - 1] ?? null) : null;
	let c = 0;

	while (c < model.columns.length) {
		const col = model.columns[c];
		if (!col) { c++; continue; }

		// Check occupied set using v2 IDs — the header row uses the 'header' sentinel
		// (see resolveMergeRowIndex in renderGridHelpers.ts) since it has no row ID of its own.
		const currentRowId = isHeader ? 'header' : (currentRow?.id ?? '');
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
			renderHeaderCell({
				el, value, col, colIdx, getRegistry, app, sourcePath, model, component,
				onCellChange, onColTypeChange, onStructuralOp, cacheKey, getSingleClickEdit, onEditNavigate,
			});
		} else {
			await renderDataCell({
				el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model,
				onCellChange, onStructuralOp, cacheKey, getSingleClickEdit, onEditNavigate,
				onEnterFormulaMode, onExitFormulaMode,
			});
		}
		c++;
	}
}

export interface RenderHeaderCellOptions {
	el:              HTMLElement;
	value:           string;
	col:             ColumnDefV2;
	colIdx:          number;
	getRegistry:     () => ChoiceRegistry;
	app:             App;
	sourcePath:      string;
	model:           TableModelV2;
	component:       Component;
	onCellChange?:    CellChangeHandler;
	onColTypeChange?: ColTypeChangeHandler;
	onStructuralOp?:  StructuralOpHandler;
	cacheKey?:       string;
	getSingleClickEdit?: () => boolean;
	onEditNavigate?: EditNavigateHandler;
}

function renderHeaderCell(options: RenderHeaderCellOptions): void {
	const {
		el, value, col, colIdx, getRegistry, app, sourcePath, model, component,
		onCellChange, onColTypeChange, onStructuralOp, cacheKey, getSingleClickEdit, onEditNavigate,
	} = options;
	// An empty header name renders an empty <span>, which — same as an empty data
	// cell's missing <p> — has no line box and collapses to just its padding,
	// making the header row visibly shorter than data rows. Most tables never hit
	// this (some column has a name), but a freshly-inserted blank table has EVERY
	// header empty at once, making it obvious. Same U+00A0 fix as renderDataCell.
	el.createSpan({ cls: 'bt-th-text', text: value || ' ' });
	if (col.type) el.addClass('bt-th-typed');

	const openPanel = (evt: MouseEvent, isDblClick = false) => {
		if (!onStructuralOp && !onColTypeChange) return;
		const ops: CellOpEntry[] = [];
		if (onStructuralOp) {
			// A header cell can itself be a merge anchor (header-only column-range merges,
			// e.g. from split-cell-col preserving the header's shape) — offer the same
			// unmerge action dataCellOps gives data cells, or a merge could never be undone.
			const merge = getMergeOrigin(0, colIdx, model);
			if (merge && merge.endCol > merge.startCol) {
				ops.push({ icon: 'table-2', label: t('unmergeCells'),
					action: () => void onStructuralOp({ type: 'unmerge-cells', anchorRowId: merge.anchorRowId, anchorColId: merge.anchorColId }) });
			}
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
			ops.push(
				{ divider: true },
				{ icon: 'copy', label: t('copyToExcel'),
					action: () => copyRangeToClipboard(model, 0, 0, colIdx, colIdx) },
				{ icon: 'file-text', label: t('copyToMarkdown'),
					action: () => copyRangeAsMarkdown(model, 0, 0, colIdx, colIdx) },
			);
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
		// Caret placement when clicking *inside* the active editor — the th would
		// otherwise intercept the click and reset the selection. Kept as its own
		// mousedown listener (independent of bindCellActivation's timer handling).
		el.addEventListener('mousedown', (evt: MouseEvent) => {
			if (!el.hasClass('bt-editing')) return;
			const editor = el.querySelector<HTMLElement>('.bt-cell-editor');
			if (!editor) return;
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
		});
		bindCellActivation(el, {
			getSingleClickEdit: () => getSingleClickEdit?.() ?? false,
			delayMs: 200,
			primaryAction: (_evt, seedChar) => { if (el.isConnected) enterEditMode(el, value, 0, colIdx, app, sourcePath, onCellChange, undefined, cacheKey, seedChar, onEditNavigate); },
			panelAction: (evt) => openPanel(evt, true),
		});
	}

	// Resume: a write-back triggered by some OTHER cell's edit committing can have
	// rebuilt this table while THIS header cell's name was mid-edit — see
	// renderEditHandoff.ts. If so, re-enter edit mode immediately with whatever
	// draft text was typed, instead of silently reverting to the column's stored name.
	if (onCellChange && cacheKey) {
		const resume = takeLiveEdit(cacheKey, 0, colIdx);
		if (resume) enterEditMode(el, value, 0, colIdx, app, sourcePath, onCellChange, undefined, cacheKey, resume.getDraftText(), onEditNavigate);
	}

	// Double-click / Ctrl+click → style-and-type panel is wired via bindCellActivation above.

	// Filter button — bottom-right corner of the header cell. (The sort MENU
	// lives in the column-selector's popup instead of a second always-hoverable
	// header icon — filter is used more often and keeps the hover-reveal spot.
	// A live sort's ACTIVE-state indicator still surfaces here though, directly
	// above the filter button, so it's never silently forgotten — see below.)
	if (onStructuralOp) {
		const activeValues = col.filter;
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

	// Live-sort active indicator — stacks directly above the filter button (same
	// corner) so a column that's both filtered and live-sorted shows both at
	// once instead of one covering the other. Only rendered for the one column
	// currently driving a live sort. Click opens a small menu (same pattern as
	// the filter button opening its panel) to switch direction or clear.
	if (onStructuralOp && model.sort?.colId === col.id) {
		const dir = model.sort.dir;
		const sortIndicatorBtn = el.createDiv({
			cls: 'bt-sort-active-btn',
			attr: {
				'aria-label':            sortActiveLabel(col.name, dir),
				'data-tooltip-position': 'top',
			},
		});
		setIcon(sortIndicatorBtn, dir === 'asc' ? 'arrow-up' : 'arrow-down');
		sortIndicatorBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			const menu = new Menu();
			menu.addItem(item => {
				item.setTitle(t('keepSortedAscending')).setIcon('arrow-up');
				if (dir === 'asc') item.setChecked(true);
				item.onClick(() => void onStructuralOp({ type: 'set-sort', sort: { colId: col.id, dir: 'asc' } }));
			});
			menu.addItem(item => {
				item.setTitle(t('keepSortedDescending')).setIcon('arrow-down');
				if (dir === 'desc') item.setChecked(true);
				item.onClick(() => void onStructuralOp({ type: 'set-sort', sort: { colId: col.id, dir: 'desc' } }));
			});
			menu.addSeparator();
			menu.addItem(item => {
				item.setTitle(t('clearLiveSort')).setIcon('x');
				item.onClick(() => void onStructuralOp({ type: 'set-sort', sort: null }));
			});
			showMenuPinned(menu, e);
		});
	}
	// Column resize is handled by the selector-strip handles (works with merges too)
}

export interface RenderDataCellOptions {
	el:              HTMLElement;
	value:           string;
	col:             ColumnDefV2;
	rowIdx:          number;
	colIdx:          number;
	registry:        ChoiceRegistry;
	app:             App;
	sourcePath:      string;
	component:       Component;
	model:           TableModelV2;
	onCellChange?:   CellChangeHandler;
	onStructuralOp?: StructuralOpHandler;
	cacheKey?:       string;
	getSingleClickEdit?: () => boolean;
	onEditNavigate?: EditNavigateHandler;
	onEnterFormulaMode?: (insertText: (label: string) => void) => void;
	onExitFormulaMode?: () => void;
}

async function renderDataCell(options: RenderDataCellOptions): Promise<void> {
	const {
		el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model,
		onCellChange, onStructuralOp, cacheKey, getSingleClickEdit, onEditNavigate,
		onEnterFormulaMode, onExitFormulaMode,
	} = options;
	const trimmed = value.trim();

	// Special type: date picker
	if (col.type === 'date') {
		renderDateCell(el, trimmed, rowIdx, colIdx, model, component, onCellChange, onStructuralOp, cacheKey, getSingleClickEdit, onEditNavigate);
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
				showMenuPinned(menu, evt, { row: rowIdx, col: colIdx });
			};

			const openTypedPanel = () => {
				if (!onStructuralOp) return;
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
			};

			// Primary action = open the value menu (classic: 100ms to allow double-click
			// detection; singleClickEdit: immediate). Style panel = double-click (classic)
			// or Ctrl/Cmd+click (singleClickEdit). Same entry point as text/date cells.
			bindCellActivation(el, {
				getSingleClickEdit: () => getSingleClickEdit?.() ?? false,
				delayMs: 100,
				primaryAction: (evt) => openMenu(evt),
				panelAction: () => openTypedPanel(),
			});
			el.addEventListener('keydown', (evt: KeyboardEvent) => {
				if (evt.key === 'Enter' || evt.key === ' ') {
					evt.preventDefault();
					el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				}
			});
		} else if (onStructuralOp) {
			// Non-interactive-value typed cell (no onCellChange) still gets its style panel.
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

	const FORMULA_ERROR_CODES: readonly FormulaErrorCode[] = ['#REF!', '#CIRCULAR!', '#DIV/0!', '#VALUE!'];
	const rowForFormula = model.rows[rowIdx - 1]; // rowIdx is 1-based for data rows
	const isFormulaError = !!rowForFormula?.formulas?.[col.id]
		&& (FORMULA_ERROR_CODES as readonly string[]).includes(trimmed);

	if (isFormulaError) {
		const pill = el.createSpan({ cls: 'bt-choice bt-choice-unknown bt-formula-error' });
		pill.createSpan({ cls: 'bt-choice-warn-icon', text: '⚠' });
		pill.createSpan({ text: trimmed });
		pill.setAttribute('aria-label', `Formula error: ${trimmed}`);
		pill.setAttribute('data-tooltip-position', 'top');
	} else if (trimmed) {
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
	} else {
		// An empty cell renders nothing at all (MarkdownRenderer is only called
		// above when trimmed is non-empty), so it has no line box and collapses
		// to just its padding — visibly shorter than a same-font-size cell with
		// one real line of text. A non-breaking space in a real <p> gives it the
		// exact same line-box height the browser would compute for actual text,
		// rather than approximating it via a CSS min-height guess — this is what
		// makes a brand-new row's cells (insert-row / split-cell's new row) not
		// look thinner than every other row. Trimmed to '' by every existing
		// "is this cell empty" check (JS trim() treats U+00A0 as whitespace),
		// so it's invisible to auto-fit/filter/aggregate and copy/paste reads
		// from the model's raw value, not this DOM placeholder.
		el.createEl('p', { text: ' ' });
	}

	const onPasteGrid = (onCellChange && onStructuralOp) ? (values: string[][]) => {
		const anchorRowId = rowId(model, rowIdx);
		const anchorColId = colId(model, colIdx);
		if (anchorRowId && anchorColId) void onStructuralOp({ type: 'paste-values', anchorRowId, anchorColId, values });
	} : undefined;

	// Formula editing is only offered for plain untyped columns — reaching this
	// point already means col.type is falsy (the date/choice branches above
	// both return early), so no separate type check is needed here. Reuses
	// the same `rowForFormula` lookup the error-pill check above already did.
	const formulaHooks: FormulaEditHooks | undefined =
		(onStructuralOp && onEnterFormulaMode && onExitFormulaMode && rowForFormula)
			? {
				model, rowId: rowForFormula.id, colId: col.id, onStructuralOp,
				onEnterFormulaMode, onExitFormulaMode,
			}
			: undefined;
	const existingFormula = rowForFormula?.formulas?.[col.id];
	// The friendly-label formula text (not `value`, which for a formula cell holds
	// the cached COMPUTED result) is what a plain open should show and select-all —
	// passed as `rawValue` itself, not as `initialText`, specifically so a plain
	// click/Enter reopen keeps select-all: `initialText` being defined means "seed
	// char or resumed draft, caret at end", and a formula cell reopening with no
	// seed is neither of those (reported: reopening an existing formula placed the
	// caret at the end instead of selecting it all, unlike every other cell type).
	const formulaDisplayValue = existingFormula ? idFormulaToLabel(model, existingFormula) : value;

	const openDataPanel = () => {
		if (el.hasClass('bt-editing') || !onStructuralOp) return;
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
	};

	if (onCellChange) {
		el.addClass('bt-td-editable');

		// Classic: single click (200 ms delay) → text editor, double click → style panel.
		// singleClickEdit: single click → editor immediately, Ctrl/Cmd+click → panel.
		// A write-back triggered by committing a DIFFERENT cell's edit can land in this
		// same ~200ms window and rebuild the whole table from scratch (see "Write-back
		// architecture") — el would then be a detached leftover; the isConnected guard
		// avoids flashing a doomed editor on it.
		bindCellActivation(el, {
			getSingleClickEdit: () => getSingleClickEdit?.() ?? false,
			delayMs: 200,
			shouldSkip: (evt) =>
				!!(evt.target as HTMLElement).closest('.internal-link') ||
				(evt.target as HTMLElement).closest('table')?.dataset.wasDragged !== undefined,
			primaryAction: (_evt, seedChar) => {
				if (!el.isConnected) return;
				enterEditMode(el, formulaDisplayValue, rowIdx, colIdx, app, sourcePath, onCellChange, onPasteGrid, cacheKey, seedChar, onEditNavigate, formulaHooks);
			},
			panelAction: () => openDataPanel(),
		});
	}

	// Resume: a write-back triggered by some OTHER cell's edit committing can have
	// rebuilt this table while THIS cell was mid-edit — see renderEditHandoff.ts.
	// If so, re-enter edit mode immediately with whatever draft text was typed,
	// instead of silently reverting to the cell's actual stored value.
	if (onCellChange && cacheKey) {
		const resume = takeLiveEdit(cacheKey, rowIdx, colIdx);
		if (resume) enterEditMode(el, value, rowIdx, colIdx, app, sourcePath, onCellChange, onPasteGrid, cacheKey, resume.getDraftText(), onEditNavigate, formulaHooks);
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
	cacheKey?: string,
	getSingleClickEdit?: () => boolean,
	onEditNavigate?: EditNavigateHandler,
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

	const openDatePanel = () => {
		if (el.hasClass('bt-editing') || !onStructuralOp) return;
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
	};

	if (onCellChange) {
		el.addClass('bt-td-editable');

		// Same entry point as the text cell: classic = delayed single click → picker,
		// double click → panel; singleClickEdit = single click → picker, Ctrl/Cmd+click
		// → panel. isConnected guard mirrors renderDataCell (concurrent write-back can
		// detach el before a delayed click fires).
		bindCellActivation(el, {
			getSingleClickEdit: () => getSingleClickEdit?.() ?? false,
			delayMs: 200,
			shouldSkip: (evt) =>
				(evt.target as HTMLElement).closest('table')?.dataset.wasDragged !== undefined,
			primaryAction: () => {
				if (!el.isConnected) return;
				enterDateEditMode(el, value, rowIdx, colIdx, onCellChange, cacheKey, undefined, onEditNavigate);
			},
			panelAction: () => openDatePanel(),
		});
	}

	// Resume: see the matching resume check in renderDataCell / renderEditHandoff.ts.
	if (onCellChange && cacheKey) {
		const resume = takeLiveEdit(cacheKey, rowIdx, colIdx);
		if (resume) enterDateEditMode(el, value, rowIdx, colIdx, onCellChange, cacheKey, resume.getDraftText(), onEditNavigate);
	}
}
