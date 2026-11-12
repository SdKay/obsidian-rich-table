import { App, Component, MarkdownRenderer, Menu, setIcon } from 'obsidian';
import { t, sortActiveLabel, typeLabel } from './i18n';
import type { ColumnDefV2, TableModelV2 } from './model';
import type { FormulaErrorCode } from './formula';
import type { ChoiceRegistry } from './choiceRegistry';
import type { CellChangeHandler, EditNavigateHandler } from './renderTypes';
import type { ColumnKinds } from './columnKind';
import type { TableEdits } from './tableEdits';
import { rowId, colId, getMergeOrigin, isRowFiltered, type ResolvedMerge } from './renderGridHelpers';
import {
	cellEffectiveStyle, cellInheritedStyle, buildCellStyleContext,
	applyColStyle, applyResolvedStyle,
} from './renderCellStyle';
import type { ResolvedStyleV2 } from './styleTarget';
import { copyRangeToClipboard, copyRangeAsMarkdown } from './renderClipboard';
import { enterDateEditMode, enterEditMode, enterNativeEditMode, type FormulaEditHooks } from './renderEditMode';
import { nativeEditorEnabled } from './nativeCellEditor';
import { idFormulaToLabel } from './formulaLabel';
import { type CellOpEntry, DATA_CELL_PANEL_OPS, dataCellOps, openFilterPanel, openCellPanel, buildAlignCellOp, withEdits } from './renderPanel';
import { showMenuPinned } from './renderHoverPin';
import { takeLiveEdit } from './renderEditHandoff';
import { growColForChoiceValue } from './renderAutofit';
import { isInsideNestedTable } from './renderOwnScope';
import { contentOwnsPress } from './cellContentOwner';
import { toggleTaskInCell } from './cellTaskToggle';
import { taskBoxAt, taskBoxesOf } from './cellTaskItems';
import { listLines, listStartAnyNumber } from './cellList';
import { measureZoomFactor } from './renderGeometry';

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
		if (contentOwnsPress(evt.target, el) || opts.shouldSkip?.(evt)) return;
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
		if (isEditing() || contentOwnsPress(evt.target, el)) return;
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
 * Returns false when the cell has no primary action bound (a cell the table
 * cannot change).
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
	/** What the table can change; every control in a cell asks it about the operation it would emit. */
	edits:           TableEdits;
	/** The table's merges, resolved once for all its cells. */
	merges:          { at: (rowIdx: number, colIdx: number) => ResolvedMerge | undefined };
	/** The table's style rules, resolved once for all its cells. */
	styleOf:         (rowIdx: number, colIdx: number) => ResolvedStyleV2;
	onCellChange:    CellChangeHandler;
	/** What the header menu offers to make a column; see columnKind.ts. */
	columnKinds:     (col: ColumnDefV2) => ColumnKinds;
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
		edits, merges, styleOf, onCellChange, columnKinds, cacheKey, getSingleClickEdit, onEditNavigate,
		onEnterFormulaMode, onExitFormulaMode,
	} = options;
	const currentRow = rowIdx > 0 ? (model.rows[rowIdx - 1] ?? null) : null;
	// The row's id lives on the <tr> (and the column's on its <col>) rather than on every cell:
	// writing two attributes per cell cost 18 ms to 45 ms on 18 000 cells, this costs one per row.
	tr.setAttribute('data-row-id', isHeader ? 'header' : (currentRow?.id ?? ''));
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
				if (edits.can('show-col-group')) {
					indicator.addEventListener('click', () =>
						edits.run({ type: 'show-col-group', colIds: groupIds }));
				}
			}
			continue;
		}

		// Normal cell — snapshot c so closures below capture the right column index
		const colIdx = c;
		const merge = merges.at(rowIdx, colIdx);
		const tag   = isHeader ? 'th' : 'td';
		const el    = tr.createEl(tag, { cls: isHeader ? 'bt-th' : 'bt-td' });
		el.dataset.row = String(rowIdx);
		el.dataset.col = String(colIdx);

		if (merge) {
			// Adjust rowspan/colspan to skip hidden or filtered-out rows/cols within the
			// merge — neither gets a <tr> of its own (see isRowFiltered's call site in
			// renderer.ts), so both must be excluded the same way or the rowspan would
			// overcount past the end of the table's actual physical rows.
			let rowSpan = 0;
			for (let ri = merge.startRow; ri <= merge.endRow; ri++) {
				const skipped = ri > 0 ? ((model.rows[ri - 1]?.hidden ?? false) || isRowFiltered(ri, model)) : false;
				if (!skipped) rowSpan++;
			}
			let colSpan = 0;
			for (let ci = merge.startCol; ci <= merge.endCol; ci++) {
				if (!model.columns[ci]?.hidden) colSpan++;
			}
			if (rowSpan > 1) el.rowSpan = rowSpan;
			if (colSpan > 1) el.colSpan = colSpan;
		}

		applyColStyle(el, col, model, colIdx, merge ? merge.endCol : colIdx);
		applyResolvedStyle(el, styleOf(rowIdx, colIdx));
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
			await renderHeaderCell({
				el, value, col, colIdx, getRegistry, app, sourcePath, model, component,
				edits, onCellChange, columnKinds, cacheKey, getSingleClickEdit, onEditNavigate,
			});
		} else {
			await renderDataCell({
				el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model,
				edits, onCellChange, cacheKey, getSingleClickEdit, onEditNavigate,
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
	edits:           TableEdits;
	onCellChange:    CellChangeHandler;
	columnKinds:     (col: ColumnDefV2) => ColumnKinds;
	cacheKey?:       string;
	getSingleClickEdit?: () => boolean;
	onEditNavigate?: EditNavigateHandler;
}

/** Every operation a header cell's panel can lead to; the panel opens when the table can do one of them. */
const HEADER_PANEL_OPS = [
	'unmerge-cells', 'insert-row', 'insert-col', 'hide-col', 'delete-col', 'split-cell-row', 'split-cell-col', 'set-align',
	'set-col-type', 'set-col-field', 'set-range-style',
] as const;

async function renderHeaderCell(options: RenderHeaderCellOptions): Promise<void> {
	const {
		el, value, col, colIdx, getRegistry, app, sourcePath, model, component,
		edits, onCellChange, columnKinds, cacheKey, getSingleClickEdit, onEditNavigate,
	} = options;
	const run = edits.run;
	// An empty header name renders an empty <span>, which — same as an empty data
	// cell's missing <p> — has no line box and collapses to just its padding,
	// making the header row visibly shorter than data rows. Most tables never hit
	// this (some column has a name), but a freshly-inserted blank table has EVERY
	// header empty at once, making it obvious. Same U+00A0 fix as renderDataCell.
	const textSpan = el.createSpan({ cls: 'bt-th-text' });
	// The type icon lives INSIDE .bt-th-text (not a corner overlay, unlike
	// filter/sort) so it always sits immediately next to the header's own
	// name, regardless of the column's alignment/width — a corner-pinned badge
	// was tried and visibly drifted away from center-aligned text on any but a
	// narrow column. Placed first so auto-fit's own .bt-th-text.offsetWidth
	// measurement (renderAutofit.ts) naturally includes its width. Purely
	// decorative — no click handler — since there's no dedicated action to
	// wire up: the type-switch panel is already one right-click/double-click away.
	if (col.type) {
		textSpan.addClass('bt-th-typed');
		const typeIcon = textSpan.createSpan({ cls: 'bt-th-type-icon' });
		setIcon(typeIcon, 'tag');
		typeIcon.setAttribute('aria-label', typeLabel(col.type));
		typeIcon.setAttribute('data-tooltip-position', 'top');
	}
	// The name goes through the same renderer as a cell's text, so a formula, a link or bold means the same in both.
	const name = textSpan.createSpan({ cls: 'bt-th-name' });
	if (value.trim() === '') name.appendText('\u00a0');
	else await MarkdownRenderer.render(app, value, name, sourcePath, component);

	const openPanel = (_evt: MouseEvent) => {
		if (!edits.canAny(HEADER_PANEL_OPS)) return;
		const kinds = columnKinds(col);
		// A header cell can itself anchor a merge (across columns, or down into the data rows), so it offers the
		// same unmerge a data cell does, or the merge could never be undone.
		const merge = getMergeOrigin(0, colIdx, model);
		const ops = withEdits([
			...(merge && (merge.endCol > merge.startCol || merge.endRow > merge.startRow) ? [{ icon: 'table-2', label: t('unmergeCells'), emits: ['unmerge-cells'],
				action: () => run({ type: 'unmerge-cells', anchorRowId: merge.anchorRowId, anchorColId: merge.anchorColId }) }] as CellOpEntry[] : []),
			// Insert first data row: afterRowId = null (insert before all data rows)
			{ icon: 'arrow-down',  label: t('insertRowBelow'),  emits: ['insert-row'], action: () => run({ type: 'insert-row', afterRowId: null }) },
			{ icon: 'arrow-left',  label: t('insertColBefore'), emits: ['insert-col'], action: () => run({ type: 'insert-col', afterColId: colIdx > 0 ? (model.columns[colIdx - 1]?.id ?? null) : null }) },
			{ icon: 'arrow-right', label: t('insertColAfter'),  emits: ['insert-col'], action: () => run({ type: 'insert-col', afterColId: col.id }) },
			{ icon: 'eye-off',     label: t('hideColumn'),      emits: ['hide-col'],   action: () => run({ type: 'hide-col', colId: col.id }) },
			{ icon: 'trash',       label: t('deleteColumn'), danger: true, emits: ['delete-col'], action: () => run({ type: 'delete-col', colId: col.id }) },
			{ divider: true },
			// Same gating as dataCellOps: a vertical-only merge can only split
			// into columns (each keeping its own copy of the row-span), a
			// horizontal-only merge only into rows, and a plain cell either way.
			...((!merge || (merge.endRow === merge.startRow && merge.endCol > merge.startCol)) ? [
				{ icon: 'rows-2', label: t('splitCellRow'), emits: ['split-cell-row'],
					action: () => run({ type: 'split-cell-row', rowId: 'header', colId: col.id }) },
			] as CellOpEntry[] : []),
			...((!merge || (merge.endCol === merge.startCol && merge.endRow > merge.startRow)) ? [
				{ icon: 'columns-2', label: t('splitCellCol'), emits: ['split-cell-col'],
					action: () => run({ type: 'split-cell-col', rowId: 'header', colId: col.id }) },
			] as CellOpEntry[] : []),
			{ divider: true },
			// The header's own align only ever affects the header cell — the
			// column-wide default (which also covers the header, as a
			// fallback) lives on the column-selector strip's menu instead
			// (renderSelectorStrips.ts), via set-col-align.
			{ ...buildAlignCellOp(
				cellEffectiveStyle(model, 0, colIdx).align,
				(align) => run({ type: 'set-align', target: `header.${col.id}`, align }),
			), emits: ['set-align'] },
			{ divider: true },
			{ icon: 'copy', label: t('copyToExcel'),
				action: () => copyRangeToClipboard(model, 0, 0, colIdx, colIdx) },
			{ icon: 'file-text', label: t('copyToMarkdown'),
				action: () => copyRangeAsMarkdown(model, 0, 0, colIdx, colIdx) },
		], edits);
		openCellPanel({
			component,
			anchor: el,
			els: [el],
			styleTarget: `header.${col.id}`,
			existingStyle: cellEffectiveStyle(model, 0, colIdx),
			inheritedStyle: cellInheritedStyle(model, 0, colIdx),
			showTextColor: true,
			styleEditable: edits.can('set-range-style'),
			cellOps: ops,
			kindSection: edits.can(kinds.emits) ? { kinds, run } : undefined,
			onApplyStyle: (bg, color, size, bold, italic) => run({ type: 'set-range-style', target: `header.${col.id}`, bg, color, size, bold, italic }),
		});
	};

	el.addEventListener('contextmenu', (evt: MouseEvent) => { evt.preventDefault(); openPanel(evt); });
	el.addEventListener('keydown', (evt: KeyboardEvent) => {
		// A Space/Enter keystroke typed INSIDE the active editor (renaming the
		// column) bubbles up to this same listener — testing the event's
		// ORIGIN, not `el`'s own mutable .bt-editing class, is what's reliable
		// here (same reasoning as cellNav.ts's document-level keydown guard —
		// see "Keyboard cell navigation" in CLAUDE.md). Without this, every
		// space typed while renaming a column got eaten (preventDefault fires
		// on the bubbled event regardless of which listener calls it) and every
		// Enter reopened the panel it had just been used to close.
		if ((evt.target as HTMLElement).closest('.bt-cell-editor')) return;
		if (evt.key === 'Enter' || evt.key === ' ') {
			evt.preventDefault();
			const r = el.getBoundingClientRect();
			openPanel(new MouseEvent('click', { clientX: r.left, clientY: r.bottom }));
		}
	});

	// Pasting a whole copied/typed table (header row included) onto a header
	// cell converts it into this table's real columns/rows in one paste —
	// table-format conversion, not a header rename — instead of the plain
	// data-cell paste's "fill starting at this exact row", which has no
	// concept of renaming a column at all.
	const onPasteGridHeader = edits.can('paste-values-with-header') ? (values: string[][]) => {
		run({ type: 'paste-values-with-header', anchorColId: col.id, values });
	} : undefined;

	const renamable = edits.can('set-col-name');
	if (renamable) {
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
			primaryAction: (_evt, seedChar) => { if (el.isConnected) enterEditMode(el, value, 0, colIdx, app, sourcePath, onCellChange, onPasteGridHeader, cacheKey, seedChar, onEditNavigate, undefined); },
			panelAction: (evt) => openPanel(evt),
		});
	}

	// Resume: a write-back triggered by some OTHER cell's edit committing can have
	// rebuilt this table while THIS header cell's name was mid-edit — see
	// renderEditHandoff.ts. If so, re-enter edit mode immediately with whatever
	// draft text was typed, instead of silently reverting to the column's stored name.
	if (renamable && cacheKey) {
		const resume = takeLiveEdit(cacheKey, 0, colIdx);
		if (resume) enterEditMode(el, value, 0, colIdx, app, sourcePath, onCellChange, onPasteGridHeader, cacheKey, resume.getDraftText(), onEditNavigate, undefined);
	}

	// Double-click / Ctrl+click → style-and-type panel is wired via bindCellActivation above.

	// Filter button — bottom-right corner of the header cell. (The sort MENU
	// lives in the column-selector's popup instead of a second always-hoverable
	// header icon — filter is used more often and keeps the hover-reveal spot.
	// A live sort's ACTIVE-state indicator still surfaces in the header too,
	// in its own bottom-left corner, so it's never silently forgotten — see below.)
	if (edits.can('set-filter')) {
		const activeValues = col.filter;
		const filterBtn = el.createDiv({
			cls: 'bt-filter-btn' + (activeValues ? ' bt-filter-active' : ''),
			attr: { 'aria-label': t('filterColumn'), 'data-tooltip-position': 'top' },
		});
		setIcon(filterBtn, 'filter');
		filterBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			openFilterPanel(el, colIdx, model, getRegistry(), run, component);
		});
	}

	// Live-sort active indicator — top-right corner, diagonally opposite the
	// filter button (bottom-right), so a column that's both filtered and
	// live-sorted shows both at once instead of one covering the other. A
	// top-anchored and a bottom-anchored 16px icon each need 3+16=19px of
	// their own corner's edge, which together (38px) exceeds a normal single-
	// line header's own height (~32px) — see the bt-th-tall-icons rule this
	// adds below for the fix, rather than moving the icon to a corner that
	// fits without it (tried first; rejected — top-right is where sort
	// belongs). Only rendered for the one column currently driving a live
	// sort. Click opens a small menu (same pattern as the filter button
	// opening its panel) to switch direction or clear.
	if (edits.can('set-sort') && model.sort?.colId === col.id) {
		const dir = model.sort.dir;
		el.addClass('bt-th-tall-icons');
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
				item.onClick(() => run({ type: 'set-sort', sort: { colId: col.id, dir: 'asc' } }));
			});
			menu.addItem(item => {
				item.setTitle(t('keepSortedDescending')).setIcon('arrow-down');
				if (dir === 'desc') item.setChecked(true);
				item.onClick(() => run({ type: 'set-sort', sort: { colId: col.id, dir: 'desc' } }));
			});
			menu.addSeparator();
			menu.addItem(item => {
				item.setTitle(t('clearLiveSort')).setIcon('x');
				item.onClick(() => run({ type: 'set-sort', sort: null }));
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
	edits:           TableEdits;
	onCellChange:    CellChangeHandler;
	cacheKey?:       string;
	getSingleClickEdit?: () => boolean;
	onEditNavigate?: EditNavigateHandler;
	onEnterFormulaMode?: (insertText: (label: string) => void) => void;
	onExitFormulaMode?: () => void;
}

async function renderDataCell(options: RenderDataCellOptions): Promise<void> {
	const {
		el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model,
		edits, onCellChange, cacheKey, getSingleClickEdit, onEditNavigate,
		onEnterFormulaMode, onExitFormulaMode,
	} = options;
	const trimmed = value.trim();
	const editable = edits.can('set-cell-content');
	const openPanel = (style: { showTextColor: boolean; showBoldItalic?: boolean }) =>
		openDataCellPanel(el, rowIdx, colIdx, model, component, edits, style);

	// Special type: date picker
	if (col.type === 'date') {
		renderDateCell(el, trimmed, rowIdx, colIdx, model, component, edits, onCellChange, cacheKey, getSingleClickEdit, onEditNavigate);
		return;
	}

	if (col.type) {
		const choiceType = registry.get(col.type);
		const option = choiceType ? registry.getOption(col.type, trimmed) : undefined;

		const pill = el.createSpan({ cls: 'bt-choice' });
		pill.dataset.choiceType = col.type;

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

		if (editable && choiceType) {
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
							// Columns no longer reserve width for their type's longest
							// possible label up front (colMinWidth) — grow reactively
							// instead, right when a value that actually needs more room
							// is picked. Never shrinks.
							// Measured back off `el` itself (this cell's own click handler has
						// no access to renderer.ts's closure-local `zoom`) — safe here
						// since the cell the user just clicked is, by definition, laid
						// out and visible.
						if (edits.can('set-col-width')) growColForChoiceValue(el, col.id, pill, edits.run, measureZoomFactor(el));
								});
					});
				}
				showMenuPinned(menu, evt, { row: rowIdx, col: colIdx });
			};

			// A typed cell's pill sets its own colour and weight, so the panel offers neither.
			const openTypedPanel = () => openPanel({ showTextColor: false, showBoldItalic: false });

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
		} else {
			// A typed cell whose value cannot be picked here still has its panel.
			el.addEventListener('dblclick', () => openPanel({ showTextColor: false, showBoldItalic: false }));
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
		// Ticking a task writes the cell's own text. The task is found from whatever was pressed, since a theme or a
		// plugin may hide the checkbox and draw a stand-in of its own.
		el.addEventListener('click', (evt: MouseEvent) => {
			const box = taskBoxAt(evt.target, el);
			if (!box) return;
			evt.preventDefault();
			evt.stopPropagation();
			if (!edits.can('set-cell-content')) return;
			const next = toggleTaskInCell(value, taskBoxesOf(el).indexOf(box));
			if (next === null) return;
			box.checked = !box.checked;
			void onCellChange(rowIdx, colIdx, next);
		}, true);
		// A soft line break (a lone \n typed via Shift+Enter, as opposed to a literal
		// <br> the user typed) is rendered by the markdown engine as "<br>\n" — the
		// trailing \n lands as a leading newline on the following text node, which
		// renders as extra vertical space and makes that break look looser than a
		// literal <br>. Strip it so every <br> in the cell — typed or soft-break —
		// has identical spacing.
		// Excludes anything inside a nested rich-table block (a cell's markdown
		// can itself be a ```rich-table``` fence) — its own <br>/<ul>/<ol> belong
		// to that nested table's own rendering, not this cell's, and rewriting
		// them here would corrupt the nested table's own list/line-break display.
		el.querySelectorAll('br').forEach(br => {
			if (isInsideNestedTable(br, el)) return;
			const next = br.nextSibling;
			if (next?.nodeType === Node.TEXT_NODE && next.textContent) {
				next.textContent = next.textContent.replace(/^\n+/, '');
			}
		});
		// Convert <ul>/<ol> to <br>-separated inline content — the only reliable way
		// to match <br> line spacing regardless of which theme variables are in use.
		el.querySelectorAll<HTMLElement>('ul, ol').forEach(list => {
			// Lists inside another list are read with it, as indented lines.
			if (list.parentElement?.closest('ul, ol') || isInsideNestedTable(list, el)) return;
			const lines = listLines(list, 0, listStartAnyNumber());
			if (lines.length === 0) return;
			// Wrap in inline-block so the block centers as a unit while items stay left-aligned.
			// Built inside a detached fragment (not activeDocument itself, which only ever
			// allows one root child) then moved into place below via replaceChild.
			const wrapper = createFragment().createDiv({ cls: 'bt-list-block' });
			lines.forEach((line, i) => {
				if (i > 0) wrapper.createEl('br');
				const marker = wrapper.createSpan({ cls: 'bt-list-marker', text: `${line.marker} ` });
				if (line.depth > 0) marker.setCssProps({ '--bt-list-depth': String(line.depth) });
				line.body.forEach(n => wrapper.appendChild(n));
			});
			// Inline-block lists that follow one another would sit side by side on one line.
			if (list.previousElementSibling?.classList.contains('bt-list-block')) list.before(createEl('br'));
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

	const onPasteGrid = edits.can('paste-values') ? (values: string[][], merges?: { r1: number; c1: number; r2: number; c2: number }[]) => {
		const anchorRowId = rowId(model, rowIdx);
		const anchorColId = colId(model, colIdx);
		if (anchorRowId && anchorColId) edits.run({ type: 'paste-values', anchorRowId, anchorColId, values, merges });
	} : undefined;

	// Formula editing is only offered for plain untyped columns — reaching this
	// point already means col.type is falsy (the date/choice branches above
	// both return early), so no separate type check is needed here. Reuses
	// the same `rowForFormula` lookup the error-pill check above already did.
	const formulaHooks: FormulaEditHooks | undefined =
		(edits.can('set-cell-formula') && onEnterFormulaMode && onExitFormulaMode && rowForFormula)
			? {
				model, rowId: rowForFormula.id, colId: col.id, onStructuralOp: edits.run,
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

	/** Plain text cells only: a formula cell keeps the built-in editor, which owns formula mode. */
	const tryNativeEdit = (draft?: string, seedChar?: string): boolean =>
		nativeEditorEnabled() && !seedChar && !existingFormula && editable
		&& enterNativeEditMode(el, value, rowIdx, colIdx, app, sourcePath, component, onCellChange, onEditNavigate, cacheKey, draft);

	const openDataPanel = () => { if (!el.hasClass('bt-editing')) openPanel({ showTextColor: true }); };

	if (editable) {
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
				(evt.target as HTMLElement).closest('table')?.dataset.wasDragged !== undefined,
			primaryAction: (_evt, seedChar) => {
				if (!el.isConnected) return;
				if (tryNativeEdit(undefined, seedChar)) return;
				enterEditMode(el, formulaDisplayValue, rowIdx, colIdx, app, sourcePath, onCellChange, onPasteGrid, cacheKey, seedChar, onEditNavigate, formulaHooks);
			},
			panelAction: () => openDataPanel(),
		});
	}

	// Resume: a write-back triggered by some OTHER cell's edit committing can have
	// rebuilt this table while THIS cell was mid-edit — see renderEditHandoff.ts.
	// If so, re-enter edit mode immediately with whatever draft text was typed,
	// instead of silently reverting to the cell's actual stored value.
	if (editable && cacheKey) {
		const resume = takeLiveEdit(cacheKey, rowIdx, colIdx);
		if (resume) {
			const draft = resume.getDraftText();
			if (!tryNativeEdit(draft)) enterEditMode(el, value, rowIdx, colIdx, app, sourcePath, onCellChange, onPasteGrid, cacheKey, draft, onEditNavigate, formulaHooks);
		}
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
	edits: TableEdits,
	onCellChange: CellChangeHandler,
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
		if (!el.hasClass('bt-editing')) openDataCellPanel(el, rowIdx, colIdx, model, component, edits, { showTextColor: true });
	};
	const editable = edits.can('set-cell-content');

	if (editable) {
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
	if (editable && cacheKey) {
		const resume = takeLiveEdit(cacheKey, rowIdx, colIdx);
		if (resume) enterDateEditMode(el, value, rowIdx, colIdx, onCellChange, cacheKey, resume.getDraftText(), onEditNavigate);
	}
}

/** The panel for one data cell: what the table can do to it, and its style when the table can change that. */
function openDataCellPanel(
	el: HTMLElement, rowIdx: number, colIdx: number, model: TableModelV2, component: Component, edits: TableEdits,
	style: { showTextColor: boolean; showBoldItalic?: boolean },
): void {
	if (!edits.canAny(DATA_CELL_PANEL_OPS)) return;
	const { sTarget, exactTarget, isMerge, rangeRule, applyStyle } = buildCellStyleContext(rowIdx, colIdx, model, edits.run);
	openCellPanel({
		component,
		anchor: el, els: [el],
		styleTarget: sTarget,
		existingStyle: cellEffectiveStyle(model, rowIdx, colIdx),
		inheritedStyle: cellInheritedStyle(model, rowIdx, colIdx, exactTarget),
		// A typed cell offers a text colour only where a range or merge rule applies to it.
		showTextColor: style.showTextColor || isMerge || !!rangeRule,
		showBoldItalic: style.showBoldItalic,
		styleEditable: edits.canAny(['set-cell-style', 'set-range-style', 'split-range-style']),
		cellOps: dataCellOps(rowIdx, colIdx, model, edits),
		onApplyStyle: applyStyle,
	});
}
