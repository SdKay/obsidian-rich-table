import { Component, Menu, setIcon } from 'obsidian';
import { t, typeLabel, hideRowsLabel, hideColsLabel, deleteRowsLabel, deleteColsLabel } from './i18n';
import type { TableModelV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import { colIndexToLetter } from './utils';
import { SPECIAL_TYPES, type ColTypeChangeHandler, type StructuralOpHandler } from './renderTypes';
import { rowId, colId, getMergeOrigin } from './renderGridHelpers';
import { cellEffectiveStyle } from './renderCellStyle';
import { copyRangeToClipboard, copyRangeAsMarkdown } from './renderClipboard';
import { pinHover, showMenuPinned } from './renderHoverPin';

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

/**
 * A "Align" trigger item that opens a second-level native Menu (Left/Center/
 * Right + Clear) instead of acting immediately — same "chevron-right icon as
 * a flyout indicator" convention already used by the column-selector's own
 * aggregate "More statistics" entry (renderer.ts). Callers own what op the
 * pick actually dispatches (`onPick`), since a whole-column pick goes through
 * the existing per-column set-col-align while every other scope (header
 * cell, a data cell/range) goes through the newer, target-string-based
 * set-align — this only builds the menu, not the op.
 */
export function buildAlignCellOp(
	currentAlign: 'left' | 'center' | 'right' | undefined,
	onPick: (align: 'left' | 'center' | 'right' | null) => void,
): CellOpDef {
	return {
		icon: 'chevron-right',
		label: t('align'),
		action: (evt: MouseEvent) => {
			const menu = new Menu();
			(['left', 'center', 'right'] as const).forEach(a => {
				menu.addItem(item => {
					item.setTitle(t(a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight'));
					item.setIcon(`align-${a}`);
					if (currentAlign === a) item.setChecked(true);
					item.onClick(() => onPick(a));
				});
			});
			menu.addSeparator();
			menu.addItem(item => {
				item.setTitle(t('alignClear'));
				item.onClick(() => onPick(null));
			});
			showMenuPinned(menu, evt);
		},
	};
}

export interface CellPanelConfig {
	component:       Component;
	anchor:          HTMLElement;
	els:             HTMLElement[];
	styleTarget:     string;
	existingStyle:   { bg?: string; color?: string; size?: number; bold?: boolean; italic?: boolean };
	inheritedStyle?: { bg?: string; color?: string; size?: number; bold?: boolean; italic?: boolean };
	showTextColor:   boolean;
	showBoldItalic?: boolean; // default true; false for typed cells where pill overrides bold/italic
	/** Default true. False hides the whole background/text-color/size/bold/
	 *  italic section and its Apply/Clear footer outright, rather than showing
	 *  controls that silently do nothing on Apply — for an xlsx-backed table
	 *  (phase 1 of xlsx WRITE support, see CLAUDE.md), which can read/display a
	 *  cell's existing style (xlsxSource.ts already resolves font/fill into
	 *  StyleRuleV2 on load) but has no write path back to the file for it yet. */
	styleEditable?: boolean;
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


/** Standard cell-op buttons for a data cell (row/col insert/delete/hide + optional unmerge).
 *  `onStructuralOp` is optional so an xlsx-backed table (phase 1 of xlsx WRITE
 *  support — see CLAUDE.md) can call this with just `onMergeOp`: only the
 *  unmerge entry (if a merge exists) comes back, none of the row/col/style
 *  ops below, which have no xlsx equivalent yet. */
export function dataCellOps(
	rowIdx: number, colIdx: number,
	model: TableModelV2, onStructuralOp: StructuralOpHandler | undefined, onMergeOp?: StructuralOpHandler,
): CellOpEntry[] {
	const ops: CellOpEntry[] = [];
	const merge = getMergeOrigin(rowIdx, colIdx, model);
	const mergeHandler = onStructuralOp ?? onMergeOp;
	if (merge && (merge.endRow > merge.startRow || merge.endCol > merge.startCol) && mergeHandler) {
		ops.push({ icon: 'table-2', label: t('unmergeCells'),
			action: () => void mergeHandler({ type: 'unmerge-cells', anchorRowId: merge.anchorRowId, anchorColId: merge.anchorColId }) });
	}
	if (!onStructuralOp) return ops;

	const r1 = merge?.startRow ?? rowIdx;
	const r2 = merge?.endRow   ?? rowIdx;
	const c1 = merge?.startCol ?? colIdx;
	const c2 = merge?.endCol   ?? colIdx;

	// Insert-row/insert-col live in the row/column selector strip's own menu
	// now, not here — see endDrag('row')/endDrag('col') in renderer.ts. Moved
	// out to shorten this per-cell menu (it was getting too long).
	ops.push(
		// Splitting a plain (unmerged) cell works either way. A merged cell only
		// has one axis left to split along — a vertical-only merge (spans rows,
		// one column) can split into 2 columns (each keeping its own copy of the
		// row-span); a horizontal-only merge, the mirror; a merge that already
		// spans both axes has no single shape left to preserve and isn't offered
		// either action — see splitMergedCellIntoRows/Cols in operations.ts.
		...((!merge || (merge.endRow === merge.startRow && merge.endCol > merge.startCol)) ? [
			{ icon: 'rows-2',    label: t('splitCellRow'),
				action: () => void onStructuralOp({ type: 'split-cell-row', rowId: rowId(model, rowIdx), colId: colId(model, colIdx) }) },
		] as CellOpEntry[] : []),
		...((!merge || (merge.endCol === merge.startCol && merge.endRow > merge.startRow)) ? [
			{ icon: 'columns-2', label: t('splitCellCol'),
				action: () => void onStructuralOp({ type: 'split-cell-col', rowId: rowId(model, rowIdx), colId: colId(model, colIdx) }) },
		] as CellOpEntry[] : []),
		{ icon: 'eye-off', label: hideRowsLabel(r1, r2),
			action: () => { for (let r = r1; r <= r2; r++) { const id = rowId(model, r); if (id) void onStructuralOp({ type: 'hide-row', rowId: id }); } } },
		{ icon: 'eye-off', label: hideColsLabel(c1, c2, colIndexToLetter),
			action: () => { for (let c = c1; c <= c2; c++) { const id = colId(model, c); if (id) void onStructuralOp({ type: 'hide-col', colId: id }); } } },
		{ icon: 'trash', label: deleteRowsLabel(r1, r2), danger: true,
			action: () => { for (let r = r2; r >= r1; r--) { const id = rowId(model, r); if (id) void onStructuralOp({ type: 'delete-row', rowId: id }); } } },
		{ icon: 'trash', label: deleteColsLabel(c1, c2, colIndexToLetter), danger: true,
			action: () => { for (let c = c2; c >= c1; c--) { const id = colId(model, c); if (id) void onStructuralOp({ type: 'delete-col', colId: id }); } } },
		{ divider: true },
		buildAlignCellOp(
			cellEffectiveStyle(model, rowIdx, colIdx).align,
			(align) => {
				const target = (r1 === r2 && c1 === c2)
					? `${rowId(model, r1)}.${colId(model, c1)}`
					: `${rowId(model, r1)}.${colId(model, c1)}:${rowId(model, r2)}.${colId(model, c2)}`;
				void onStructuralOp({ type: 'set-align', target, align });
			},
		),
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
 * Clamp a fully-populated floating panel into the viewport using its REAL
 * measured size. Callers set an initial guess-based position at creation time
 * (so the panel doesn't flash at 0,0), then call this once the content exists —
 * a fixed height estimate undershoots a tall panel (e.g. cell-ops + full style
 * section + Apply/Clear footer) and pushes the buttons below the fold, where
 * they can't be clicked. Prefers below the anchor, flips above if that
 * overflows, and finally pins to the viewport edge (with a max-height so an
 * over-tall panel scrolls internally rather than clipping its footer).
 */
export function clampPanelToViewport(
	panel: HTMLElement, anchor: DOMRect,
	vars: { top: string; left: string; maxHeight: string },
): void {
	const gap = 8;
	const vh = activeWindow.innerHeight;
	const vw = activeWindow.innerWidth;

	// Cap height to the viewport FIRST so the measurement below reflects the
	// clamped (possibly internally-scrolling) size, not the natural overflow.
	panel.setCssProps({ [vars.maxHeight]: `${vh - gap * 2}px` });
	const h = panel.offsetHeight;
	const w = panel.offsetWidth;

	let top = anchor.bottom + 4;
	if (top + h > vh - gap) top = anchor.top - h - 4;      // flip above the anchor
	if (top + h > vh - gap) top = vh - gap - h;            // still overflowing: pin to bottom edge
	top = Math.max(gap, top);

	let left = anchor.left;
	if (left + w > vw - gap) left = anchor.right - w;
	left = Math.max(gap, left);

	panel.setCssProps({ [vars.top]: `${top}px`, [vars.left]: `${left}px` });
}

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

	// This panel renders to document.body, outside the table's own DOM subtree —
	// pin the table's hover state open so moving the mouse onto the panel doesn't
	// collapse the selector/edge strips out from under it (see renderHoverPin.ts).
	const unpin = pinHover();
	let detach: (() => void) | null = null;
	const close = () => {
		panel.remove();
		if (closeActivePanel === doClose) closeActivePanel = null;
		detach?.();
		unpin();
	};
	const doClose = close;
	closeActivePanel = doClose;
	// Registering close() (not just unpin) is load-bearing, not just a safety
	// net: bindPanelDismiss's outside-click/Escape listeners are registered on
	// THIS component (registerDomEvent), so when the component unloads (note
	// switch, or an unrelated write-back rebuilding this table into a fresh
	// instance) those listeners are torn down too — but the panel's own <div>,
	// parented to document.body rather than the table's containerEl, is never
	// part of what Obsidian tears down. Without this, the panel is left on
	// screen with no listeners left to dismiss it: Escape, outside-click, and
	// note-switch all silently stop working. close() already calls unpin()
	// itself, so registering close() alone covers both without a second,
	// separate unpin registration — and it's safe to call again later via a
	// normal button/dismiss path (panel.remove()/detach()/unpin() are all
	// idempotent).
	component.register(close);

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

	clampPanelToViewport(panel, ar, {
		top: '--fp-top', left: '--fp-left', maxHeight: '--fp-maxh',
	});
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

	// Style section — entirely skipped (no controls, no Apply/Clear footer) when
	// styleEditable is false, rather than rendering controls whose Apply would
	// silently do nothing. See CellPanelConfig's own doc comment on the field.
	const styleEditable = config.styleEditable !== false;
	let bgEnable: HTMLInputElement | null = null;
	let bgPicker: HTMLInputElement | null = null;
	let colorEnable: HTMLInputElement | null = null;
	let colorPicker: HTMLInputElement | null = null;
	let sizeInput: HTMLInputElement | null = null;
	let boldCheck: HTMLInputElement | null = null;
	let italicCheck: HTMLInputElement | null = null;
	let clearBtn: HTMLButtonElement | null = null;
	let applyBtn: HTMLButtonElement | null = null;

	if (styleEditable) {
		const styleEl = panel.createDiv({ cls: 'bt-cp-style' });
		const bgRow    = styleEl.createDiv({ cls: 'bt-cp-style-row' });
		bgRow.createSpan({ cls: 'bt-cp-style-label', text: t('background') });
		const bgWrap   = bgRow.createDiv({ cls: 'bt-sp-color-wrap' });
		bgEnable = bgWrap.createEl('input', { attr: { type: 'checkbox' } });
		bgPicker = bgWrap.createEl('input', { cls: 'bt-sp-color', attr: { type: 'color', value: existingStyle.bg ?? '#ffffff' } });
		bgEnable.checked  = !!existingStyle.bg;
		bgPicker.disabled = !bgEnable.checked;

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
		sizeInput = sizeWrap.createEl('input', { cls: 'bt-sp-size',
			attr: { type: 'number', min: '8', max: '72', step: '1', placeholder: 'Default',
			        value: existingStyle.size != null ? String(existingStyle.size) : '' },
		});
		sizeWrap.createSpan({ text: 'px' });

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
		clearBtn = styleFoot.createEl('button', { cls: 'bt-sp-clear-btn', text: t('clearFormat') });
		applyBtn = styleFoot.createEl('button', { cls: 'bt-sp-apply',     text: t('apply') });
	}

	const preview = () => {
		if (!bgEnable || !bgPicker || !sizeInput) return;
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
	bgEnable?.addEventListener('change', () => { if (bgPicker && bgEnable) bgPicker.disabled = !bgEnable.checked; preview(); });
	bgPicker?.addEventListener('input', preview);
	colorEnable?.addEventListener('change', () => { if (colorPicker) colorPicker.disabled = !colorEnable?.checked; preview(); });
	colorPicker?.addEventListener('input', preview);
	sizeInput?.addEventListener('input', preview);
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
			showMenuPinned(m, evt);
		});
	}

	// This panel renders to document.body, outside the table's own DOM subtree —
	// pin the table's hover state open so moving the mouse onto the panel doesn't
	// collapse the selector/edge strips out from under it (see renderHoverPin.ts).
	const unpin = pinHover();

	// Actions
	let committed = false;
	let detachGlobalListeners: (() => void) | null = null;
	const close = (restore: boolean) => {
		if (!committed) { if (restore) restoreEls(); committed = true; }
		panel.remove();
		if (closeActivePanel === thisClose) closeActivePanel = null;
		detachGlobalListeners?.();
		config.onClose?.();
		unpin();
	};
	const thisClose = () => close(true);
	closeActivePanel = thisClose;
	// Registering thisClose (not just unpin) is load-bearing, not just a safety
	// net — see openFilterPanel's close() comment for the full reasoning: this
	// component unloading (note switch, or an unrelated write-back rebuild)
	// tears down bindPanelDismiss's Escape/outside-click listeners without
	// ever removing the panel <div> itself (parented to document.body, outside
	// the table's own containerEl), leaving it stuck on screen with nothing
	// left to dismiss it. restore=true mirrors thisClose's own Escape/outside-
	// click behaviour — treat an involuntary teardown as a cancel, not a
	// silent commit of the live preview. thisClose already calls unpin()
	// itself, so this one registration covers both.
	component.register(thisClose);
	clearBtn?.addEventListener('click', () => { onApplyStyle(null, null, null, null, null); close(false); });
	applyBtn?.addEventListener('click', () => {
		onApplyStyle(
			bgEnable?.checked ? (bgPicker?.value ?? null) : null,
			colorEnable?.checked ? (colorPicker?.value ?? null) : null,
			sizeInput?.value.trim() ? parseInt(sizeInput.value.trim(), 10) : null,
			boldCheck ? (boldCheck.checked ? true : null) : null,
			italicCheck ? (italicCheck.checked ? true : null) : null,
		);
		close(false);
	});
	// Enter in the panel (not in size input) confirms; handled here for when a
	// panel control has focus. A no-op when styleEditable is false (applyBtn is
	// null, nothing to confirm).
	panel.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' && evt.target !== sizeInput) { evt.preventDefault(); applyBtn?.click(); }
	});
	detachGlobalListeners = bindPanelDismiss(component, panel, () => close(true));

	// Re-clamp now that the panel is fully populated — the fixed estimate used at
	// creation time can't know the real height (cell-ops + style rows + footer).
	clampPanelToViewport(panel, ar, {
		top: '--bt-cp-top', left: '--bt-cp-left', maxHeight: '--bt-cp-maxh',
	});
	return panel;
}
