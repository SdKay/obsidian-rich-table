/**
 * Makes the cells of a table whose rows come from somewhere (a tasks table's file and path columns) lead there. The text
 * of the cell stays what it was, so copying, searching and sorting are unchanged; only the drawing gets a link, with
 * the look and the modifier keys of any other link.
 */
import { Keymap } from 'obsidian';
import type { ColumnDefV2, TableModelV2 } from './model';
import { ownCells } from './renderOwnScope';

export interface RowJump {
	/** Whether the cells of this column are a way to the row's place. */
	column(col: ColumnDefV2): boolean;
	/** The note a row came from, for the link's hover preview; null when it has none. */
	note(rowId: string): string | null;
	/** Opens the row's place; false when the row has none. */
	open(rowId: string, where: string | boolean): boolean;
}

export function renderRowJump(table: HTMLElement, model: TableModelV2, jump: RowJump): void {
	for (const cell of ownCells(table)) {
		const row = Number(cell.dataset.row);
		const col = model.columns[Number(cell.dataset.col)];
		if (!(row >= 1) || !col || !jump.column(col)) continue;
		const rowId = cell.closest('tr')?.dataset.rowId;
		const text = cell.querySelector<HTMLElement>(':scope > p');
		const note = rowId ? jump.note(rowId) : null;
		if (!rowId || !note || !text || text.textContent?.trim() === '') continue;
		const link = createEl('a', { cls: 'internal-link', text: text.textContent ?? '' });
		link.setAttribute('href', '#');
		// The attribute Obsidian's hover preview reads.
		link.setAttribute('data-href', note);
		text.replaceChildren(link);
		link.addEventListener('click', evt => {
			if (evt.button !== 0) return;
			evt.preventDefault();
			evt.stopPropagation();
			jump.open(rowId, Keymap.isModEvent(evt));
		}, true);
	}
}
