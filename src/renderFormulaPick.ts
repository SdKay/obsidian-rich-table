/**
 * Picking cells for a formula. While a cell's editor holds a formula, pressing on another cell and dragging inserts
 * a reference to the range into that editor (`B1:C2`, or `C2` for one cell), and shows the range selected while the
 * drag goes on. The state lives here, and only here: the cell editor reports entering and leaving formula mode, the
 * table's pointer handlers report the drag.
 */
import type { TableModelV2 } from './model';
import { rowId, colId } from './renderGridHelpers';
import { cellIdsToLabel, rangeIdsToLabel } from './formulaLabel';
import { ownCells } from './renderOwnScope';

type At = { row: number; col: number };

export interface FormulaPick {
	/** A cell's editor holds a formula; `insertText` puts a reference at its caret. */
	enter(insertText: (label: string) => void): void;
	/** The editor left formula mode: nothing is picked any more. */
	exit(): void;
	/** Whether a press on another cell picks a reference rather than selecting. */
	readonly active: boolean;
	/** Whether a drag is under way. */
	readonly dragging: boolean;
	start(at: At): void;
	extend(at: At): void;
	/** Inserts the reference to the range and ends the drag. */
	finish(): void;
}

export function createFormulaPick(model: TableModelV2, table: HTMLElement): FormulaPick {
	let insertText: ((label: string) => void) | null = null;
	let from: At | null = null;
	let to: At | null = null;

	const label = (start: At, end: At): string | null => {
		const startRowId = rowId(model, start.row), startColId = colId(model, start.col);
		const endRowId   = rowId(model, end.row),   endColId   = colId(model, end.col);
		if (!startRowId || !startColId || !endRowId || !endColId) return null;
		if (start.row === end.row && start.col === end.col) return cellIdsToLabel(model, startRowId, startColId);
		return rangeIdsToLabel(model, startRowId, startColId, endRowId, endColId);
	};

	// The same `.bt-selected` look as an ordinary selection, so the range being picked reads as a selection. The
	// ordinary selection itself is left alone: picking a reference does not use it.
	const highlight = () => {
		ownCells(table).forEach(e => {
			const row = parseInt(e.dataset.row ?? '-1');
			const col = parseInt(e.dataset.col ?? '-1');
			const inRange = !!from && !!to &&
				row >= Math.min(from.row, to.row) && row <= Math.max(from.row, to.row) &&
				col >= Math.min(from.col, to.col) && col <= Math.max(from.col, to.col);
			e.toggleClass('bt-selected', inRange);
		});
	};

	return {
		enter(fn) { insertText = fn; },
		exit() { insertText = null; from = null; to = null; highlight(); },
		get active() { return insertText !== null; },
		get dragging() { return insertText !== null && from !== null; },
		start(at) { from = at; to = at; highlight(); },
		extend(at) { to = at; highlight(); },
		finish() {
			if (insertText && from && to) {
				const text = label(from, to);
				if (text) insertText(text);
			}
			from = null;
			to = null;
			highlight();
		},
	};
}
