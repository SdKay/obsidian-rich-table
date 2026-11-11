/**
 * Selecting a range of cells by dragging across them, which opens the panel for that range on release. While a
 * cell's editor holds a formula, a press on another cell picks a reference instead (renderFormulaPick.ts).
 */
import type { FormulaPick } from './renderFormulaPick';
import { contentOwnsPress } from './cellContentOwner';
import { dragSelectsRange } from './dragIntent';

export interface RenderCellDragSelectContext {
	/** Whether the table's cells can be edited. Where they cannot, a drag leaves the text to the browser; see dragIntent.ts. */
	cellsEditable: boolean;
	table: HTMLTableElement;
	formulaPick: FormulaPick;
	sel: { start: { row: number; col: number } | null; end: { row: number; col: number } | null; dragging: boolean; hasMoved: boolean; ctrlHeld: boolean };
	clearSel: () => void;
	updateHighlights: () => void;
	removeSelectionPanel: () => void;
	showSelectionPanel: () => void;
}

export function renderCellDragSelect(ctx: RenderCellDragSelectContext): void {
	const { cellsEditable, table, formulaPick, sel, clearSel, updateHighlights, removeSelectionPanel, showSelectionPanel } = ctx;
	// ── Cell drag-select ─────────────────────────────────────────────────────
	// Unified across header AND data cells, attached at the table level rather
	// than separately to thead/tbody: a header-anchored merge can now reach
	// down into real data rows, and those rows are hosted in <thead> (see
	// computeHeaderRowSpan) purely so their rowspan renders correctly — a
	// thead/tbody-split pair of listeners would silently miss such a row
	// entirely (thead's old version only matched <th>, tbody's only fired for
	// descendants of <tbody>). Matching `[data-row][data-col]` regardless of
	// tag or physical parent means "is this the header" is decided purely by
	// the row VALUE (0), never by which element happened to contain it.
	const CELL_SELECTOR = 'td[data-row][data-col], th[data-row][data-col]';

	// Capture-phase: a mousedown+mouseup on another cell still fires a native
	// `click` afterward, which would otherwise reach THAT cell's own
	// bindCellActivation listener (registered directly on its <td>, bubble
	// phase) before bubbling up to anything registered here — by the time a
	// bubble-phase listener here could see it, the other cell would already
	// have opened its own editor and stolen focus (reproduced: reference
	// insertion worked, but focus jumped to the clicked cell). Capturing on
	// table runs BEFORE the target's own bubble listener, so swallowing it
	// here stops that from ever happening. A click inside the formula
	// editor's own cell is left alone — that's just normal caret placement.
	table.addEventListener('click', (evt: MouseEvent) => {
		if (!formulaPick.active) return;
		if ((evt.target as HTMLElement).closest('.bt-editing')) return;
		evt.preventDefault();
		evt.stopPropagation();
	}, { capture: true });

	table.addEventListener('mousedown', (evt: MouseEvent) => {
		if (evt.button !== 0) return;
		// A table whose cells cannot be edited (a locked one) leaves the press to the browser, whose own drag selects
		// text inside a cell for Ctrl+C; the preventDefault below would block that. Alt asks for a range instead.
		const rangeIntended = dragSelectsRange(cellsEditable, evt.altKey);
		if (!rangeIntended && !formulaPick.active) return;
		if (formulaPick.active) {
			// A cell is mid-formula-edit — clicking ANOTHER cell inserts a
			// reference instead of the normal drag-select/open-editor behaviour.
			// A click inside the editor's OWN cell falls through to native caret
			// placement (formula text is plain, freely hand-editable). The
			// header can't be referenced by a formula at all, so a header click
			// here is simply a no-op, same as it always was for any other
			// non-referenceable target.
			if ((evt.target as HTMLElement).closest('.bt-editing')) return;
			const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
			if (!cell) return;
			const row = parseInt(cell.dataset.row ?? '-1');
			const col = parseInt(cell.dataset.col ?? '-1');
			if (row < 1 || col < 0) return;
			evt.preventDefault();
			formulaPick.start({ row, col });
			const onFormulaMouseUp = () => {
				formulaPick.finish();
				activeDocument.removeEventListener('mouseup', onFormulaMouseUp);
			};
			activeDocument.addEventListener('mouseup', onFormulaMouseUp, { once: true });
			return;
		}
		// Don't interfere when clicking inside an active cell editor —
		// preventDefault would block the browser from placing the cursor
		if ((evt.target as HTMLElement).closest('.bt-editing')) return;
		const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
		// A nested table's cells are its own; so is a control inside this table's cell.
		if (!cell || cell.closest('table') !== table || contentOwnsPress(evt.target, cell)) return;
		const row = parseInt(cell.dataset.row ?? '-1');
		const col = parseInt(cell.dataset.col ?? '-1');
		if (row < 0 || col < 0) return; // any real cell, header (row 0) included
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

	table.addEventListener('mouseover', (evt: MouseEvent) => {
		if (formulaPick.dragging) {
			const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
			if (!cell) return;
			const row = parseInt(cell.dataset.row ?? '-1');
			const col = parseInt(cell.dataset.col ?? '-1');
			if (row < 1 || col < 0) return;
			formulaPick.extend({ row, col });
			return;
		}
		if (!sel.dragging) return;
		const cell = (evt.target as HTMLElement).closest<HTMLElement>(CELL_SELECTOR);
		if (!cell || cell.closest('table') !== table) return;
		const row = parseInt(cell.dataset.row ?? '-1');
		const col = parseInt(cell.dataset.col ?? '-1');
		if (row < 0 || col < 0) return;
		if (row !== sel.end?.row || col !== sel.end?.col) {
			sel.end = { row, col };
			sel.hasMoved = true;
			table.dataset.wasDragged = ''; // only set on actual movement, not every click
			updateHighlights();
		}
	});
}
