import { Component } from 'obsidian';
import { t, gridSizeCaption } from './i18n';
import { clampPanelToViewport, bindPanelDismiss } from './renderPanel';

const MAX_GRID_ROWS = 6;
const MAX_GRID_COLS = 8;
/** Sanity ceiling for the manual row/col inputs — mirrors the pipe-table
 *  mirror's own MIRROR_LIMIT precedent (serializer.ts): a typo like an extra
 *  zero shouldn't be able to make renderTable() build an unresponsive grid. */
const MAX_CUSTOM_SIZE = 50;

export interface GridSizePickerOptions {
	component: Component;
	/** Element the picker is positioned below (falls back to above/clamped if
	 *  there's no room — see clampPanelToViewport). */
	anchor: HTMLElement;
	onConfirm: (rows: number, cols: number) => void;
}

/**
 * Word/Sheets-style "insert table" size picker: an 8×6 grid where hovering
 * highlights the rectangle from the top-left corner to the hovered cell and
 * shows a live "R × C" caption; clicking a cell confirms that size
 * immediately. A pair of number inputs below it is the precise/overflow path
 * for sizes past the visible grid (matches Word's own "Insert Table..."
 * dialog fallback next to its hover grid).
 */
export function openGridSizePicker(opts: GridSizePickerOptions): void {
	const { component, anchor, onConfirm } = opts;

	const panel = activeDocument.body.createDiv({ cls: 'bt-grid-picker' });
	const ar = anchor.getBoundingClientRect();
	// Initial guess-positioned (clamped again below once the panel has real content).
	panel.setCssProps({ '--bt-gp-top': `${ar.bottom + 4}px`, '--bt-gp-left': `${ar.left}px` });

	const caption = panel.createDiv({ cls: 'bt-gp-caption', text: gridSizeCaption(1, 1) });

	const grid = panel.createDiv({ cls: 'bt-gp-grid' });
	grid.setCssProps({ '--bt-gp-cols': `${MAX_GRID_COLS}` });
	const cells: HTMLElement[] = [];
	for (let r = 0; r < MAX_GRID_ROWS; r++) {
		for (let c = 0; c < MAX_GRID_COLS; c++) {
			const cell = grid.createDiv({ cls: 'bt-gp-cell' });
			cell.dataset.r = String(r);
			cell.dataset.c = String(c);
			cells.push(cell);
		}
	}

	const highlight = (hoverR: number, hoverC: number) => {
		for (const cell of cells) {
			const r = Number(cell.dataset.r);
			const c = Number(cell.dataset.c);
			cell.toggleClass('is-active', r <= hoverR && c <= hoverC);
		}
		caption.setText(gridSizeCaption(hoverR + 1, hoverC + 1));
	};
	highlight(0, 0);

	const close = () => {
		panel.remove();
		detach();
	};

	grid.addEventListener('mouseover', (evt: MouseEvent) => {
		const cell = (evt.target as HTMLElement).closest<HTMLElement>('.bt-gp-cell');
		if (!cell) return;
		highlight(Number(cell.dataset.r), Number(cell.dataset.c));
	});
	grid.addEventListener('click', (evt: MouseEvent) => {
		const cell = (evt.target as HTMLElement).closest<HTMLElement>('.bt-gp-cell');
		if (!cell) return;
		onConfirm(Number(cell.dataset.r) + 1, Number(cell.dataset.c) + 1);
		close();
	});

	// Manual rows/cols entry — the precise/overflow path for sizes past the grid.
	const customRow = panel.createDiv({ cls: 'bt-gp-custom' });
	const rowsInput = customRow.createEl('input', {
		cls: 'bt-gp-input',
		attr: { type: 'number', min: '1', max: String(MAX_CUSTOM_SIZE), value: '3', 'aria-label': t('gridPickerRows') },
	});
	customRow.createSpan({ cls: 'bt-gp-x', text: '×' });
	const colsInput = customRow.createEl('input', {
		cls: 'bt-gp-input',
		attr: { type: 'number', min: '1', max: String(MAX_CUSTOM_SIZE), value: '3', 'aria-label': t('gridPickerCols') },
	});
	const insertBtn = customRow.createEl('button', { cls: 'bt-gp-insert-btn', text: t('gridPickerInsert') });

	const confirmCustom = () => {
		const clamp = (raw: string) => Math.max(1, Math.min(MAX_CUSTOM_SIZE, parseInt(raw, 10) || 1));
		onConfirm(clamp(rowsInput.value), clamp(colsInput.value));
		close();
	};
	insertBtn.addEventListener('click', confirmCustom);
	panel.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' && (evt.target === rowsInput || evt.target === colsInput)) {
			evt.preventDefault();
			confirmCustom();
		}
	});

	const detach = bindPanelDismiss(component, panel, close);
	// Belt-and-suspenders: if the empty-block banner that opened this picker gets
	// torn down (e.g. the block stops being empty from elsewhere) before the user
	// acts, nothing else would call close() — leaking the panel and its listeners.
	component.register(() => panel.remove());

	clampPanelToViewport(panel, ar, {
		top: '--bt-gp-top', left: '--bt-gp-left', maxHeight: '--bt-gp-maxh',
	});
}
