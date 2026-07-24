import { App, Component, MarkdownRenderer, Menu, setIcon } from 'obsidian';
import { t, sortActiveLabel } from './i18n';
import type { ColumnDefV2, TableModelV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { CellChangeHandler, ColTypeChangeHandler, StructuralOpHandler } from './renderTypes';
import { rowId, colId, getMergeOrigin } from './renderGridHelpers';
import {
	cellEffectiveStyle, cellInheritedStyle, buildCellStyleContext,
	applyColStyle, applyStyleRulesV2,
} from './renderCellStyle';
import { copyRangeToClipboard, copyRangeAsMarkdown } from './renderClipboard';
import { enterDateEditMode, enterEditMode } from './renderEditMode';
import { type CellOpEntry, dataCellOps, openFilterPanel, openCellPanel } from './renderPanel';
import { showMenuPinned } from './renderHoverPin';

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
}

export async function renderRow(options: RenderRowOptions): Promise<void> {
	const {
		tr, rowIdx, model, occupied, registry, getRegistry, app, sourcePath, component, isHeader,
		onCellChange, onColTypeChange, onStructuralOp,
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
				onCellChange, onColTypeChange, onStructuralOp,
			});
		} else {
			await renderDataCell({
				el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model,
				onCellChange, onStructuralOp,
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
}

function renderHeaderCell(options: RenderHeaderCellOptions): void {
	const {
		el, value, col, colIdx, getRegistry, app, sourcePath, model, component,
		onCellChange, onColTypeChange, onStructuralOp,
	} = options;
	el.createSpan({ cls: 'bt-th-text', text: value });
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
}

async function renderDataCell(options: RenderDataCellOptions): Promise<void> {
	const { el, value, col, rowIdx, colIdx, registry, app, sourcePath, component, model, onCellChange, onStructuralOp } = options;
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
				showMenuPinned(menu, evt);
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
				const onPasteGrid = onStructuralOp ? (values: string[][]) => {
					const anchorRowId = rowId(model, rowIdx);
					const anchorColId = colId(model, colIdx);
					if (anchorRowId && anchorColId) void onStructuralOp({ type: 'paste-values', anchorRowId, anchorColId, values });
				} : undefined;
				enterEditMode(el, value, rowIdx, colIdx, app, sourcePath, onCellChange, onPasteGrid);
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
