import { Component, Menu, setIcon } from 'obsidian';
import { t, typeLabel, hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel } from './i18n';
import type { TableModelV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import { colIndexToLetter } from './utils';
import { SPECIAL_TYPES, type ColTypeChangeHandler, type StructuralOpHandler } from './renderTypes';
import { rowId, colId, getMergeOrigin } from './renderGridHelpers';
import { copyRangeToClipboard, copyRangeAsMarkdown } from './renderClipboard';

export interface CellOpDef {
	icon:    string;
	label:   string;
	danger?: boolean;
	/** Receives the triggering click event — lets an op open its own native
	 *  Obsidian Menu (e.g. a "more options" flyout) positioned at the click. */
	action:  (evt: MouseEvent) => void;
}

/** A thin visual divider between groups of cell-op buttons. */
export interface CellOpDivider {
	divider: true;
}

export type CellOpEntry = CellOpDef | CellOpDivider;

export interface CellPanelConfig {
	component:       Component;
	anchor:          HTMLElement;
	els:             HTMLElement[];
	styleTarget:     string;
	existingStyle:   { bg?: string; color?: string; size?: number; bold?: boolean; italic?: boolean };
	inheritedStyle?: { bg?: string; color?: string; size?: number; bold?: boolean; italic?: boolean };
	showTextColor:   boolean;
	showBoldItalic?: boolean; // default true; false for typed cells where pill overrides bold/italic
	cellOps:       CellOpEntry[];
	typeSection?:  {
		colIdx:          number;
		currentType?:    string;
		getRegistry:     () => ChoiceRegistry;
		onColTypeChange: ColTypeChangeHandler;
	};
	onApplyStyle: (bg: string | null, color: string | null, size: number | null, bold: boolean | null, italic: boolean | null) => void;
	onClose?:     () => void;
}


/** Standard cell-op buttons for a data cell (row/col insert/delete/hide + optional unmerge). */
export function dataCellOps(
	rowIdx: number, colIdx: number,
	model: TableModelV2, onStructuralOp: StructuralOpHandler,
): CellOpEntry[] {
	const ops: CellOpEntry[] = [];
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
		{ divider: true },
		{ icon: 'copy', label: t('copyToExcel'),
			action: () => copyRangeToClipboard(model, r1, r2, c1, c2) },
		{ icon: 'file-text', label: t('copyToMarkdown'),
			action: () => copyRangeAsMarkdown(model, r1, r2, c1, c2) },
	);
	return ops;
}

// Module-level reference so any new openCellPanel call can close the previous one first.
let closeActivePanel: (() => void) | null = null;

/**
 * Wires outside-click + Escape dismissal for a floating panel; every popup
 * (cell panel, filter panel, future ones) shares this one implementation.
 * Deferred via setTimeout(0) so the click/pointerup that OPENED the panel
 * doesn't immediately count as an "outside" click and close it again.
 *
 * Listens for both 'mousedown' and 'click' — clicking somewhere the editor
 * can't place a cursor (e.g. blank space past the end of a rendered table)
 * doesn't reliably fire both event types, and a panel with only one has no
 * other way to close in that case. Calling onDismiss() twice for one
 * physical click is expected to be harmless (idempotent) on the caller's side.
 *
 * Returns a detach function — call it once the panel is closed some other
 * way (Apply/Clear button, etc.) so these listeners don't leak.
 */
export function bindPanelDismiss(component: Component, panel: HTMLElement, onDismiss: () => void): () => void {
	let detach: (() => void) | null = null;
	window.setTimeout(() => {
		const outside = (evt: MouseEvent) => {
			if (!panel.contains(evt.target as Node)) onDismiss();
		};
		const escKey = (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') { evt.stopPropagation(); onDismiss(); }
		};
		component.registerDomEvent(activeDocument, 'mousedown', outside);
		component.registerDomEvent(activeDocument, 'click', outside);
		component.registerDomEvent(activeDocument, 'keydown', escKey);
		detach = () => {
			activeDocument.removeEventListener('mousedown', outside);
			activeDocument.removeEventListener('click', outside);
			activeDocument.removeEventListener('keydown', escKey);
		};
	}, 0);
	return () => detach?.();
}

/** Filter dropdown panel for a column. */
export function openFilterPanel(
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

	const current = new Set(col.filter ?? []);
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

	let detach: (() => void) | null = null;
	const close = () => {
		panel.remove();
		if (closeActivePanel === doClose) closeActivePanel = null;
		detach?.();
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
	// Enter-confirms is specific to this panel's checkbox list; dismissal
	// (outside-click / Escape) is shared with every other panel.
	panel.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') { e.preventDefault(); applyBtn.click(); }
	});
	detach = bindPanelDismiss(component, panel, close);
}

/** Unified panel shown on double-click for all cell types (header / data / selection). */
export function openCellPanel(config: CellPanelConfig): HTMLElement {
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
		// !important: matches applyResolvedStyle — must keep outranking any theme
		// decoration on these same properties after restore.
		if (s.bg)      e.style.setProperty('background-color', s.bg, 'important'); else e.style.removeProperty('background-color');
		if (s.color)   e.style.setProperty('color', s.color, 'important');         else e.style.removeProperty('color');
		if (s.size)    e.style.setProperty('font-size', s.size, 'important');       else e.style.removeProperty('font-size');
		if (s.sizeVar) e.style.setProperty('--bt-cell-font-size', s.sizeVar, 'important'); else e.style.removeProperty('--bt-cell-font-size');
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
			if ('divider' in op) {
				panel.createDiv({ cls: 'bt-cp-divider' });
				continue;
			}
			const item = panel.createDiv({ cls: `bt-cp-item${op.danger ? ' bt-cp-danger' : ''}` });
			const iconEl = item.createSpan({ cls: 'bt-cp-item-icon' });
			setIcon(iconEl, op.icon);
			item.createSpan({ text: op.label });
			item.addEventListener('click', (evt: MouseEvent) => { op.action(evt); close(false); });
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
			// !important: matches applyResolvedStyle — preview must show the same
			// win-over-theme-decoration behavior the committed style will have.
			if (bv)    e.style.setProperty('background-color', bv, 'important'); else e.style.removeProperty('background-color');
			if (cv)    e.style.setProperty('color', cv, 'important');             else e.style.removeProperty('color');
			if (sv) {
				e.style.setProperty('font-size', sv, 'important');
				e.style.setProperty('--bt-cell-font-size', sv, 'important');
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
	detachGlobalListeners = bindPanelDismiss(component, panel, () => close(true));
	return panel;
}
