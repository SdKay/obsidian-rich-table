/**
 * Moving between cells with the keyboard while one is Selected, and pasting from the clipboard at the selection.
 * The keys are taken only while this table has a Selected cell, so a table the user has not clicked into never
 * swallows a keystroke meant for the note.
 */
import { Notice, type Component } from 'obsidian';
import type { TableModelV2 } from './model';
import type { CellChangeHandler } from './renderTypes';
import type { TableEdits } from './tableEdits';
import { moveCell, type NavCell } from './cellNav';
import { t } from './i18n';
import { triggerPrimaryAction } from './renderCell';
import { parseHtmlTableWithMerges, parseMarkdownPipeTable } from './renderClipboard';
import { colId, resolveCellValue, rowId } from './renderGridHelpers';
import { getActiveCellMenu } from './renderHoverPin';

export interface RenderKeyboardContext {
	model: TableModelV2;
	component: Component;
	edits: TableEdits;
	onCellChange: CellChangeHandler;
	occupied: Set<string>;
	table: HTMLTableElement;
	sel: { start: { row: number; col: number } | null; end: { row: number; col: number } | null; dragging: boolean; hasMoved: boolean; ctrlHeld: boolean };
	effectiveSelRect: () => { r1: number; r2: number; c1: number; c2: number } | null;
	selectCell: (next: NavCell | null) => void;
}

export function renderKeyboard(ctx: RenderKeyboardContext): void {
	const { model, component, edits, onCellChange, occupied, table, sel, effectiveSelRect, selectCell } = ctx;
	// ── Keyboard cell navigation, Selected state (see cellNav.ts) ────────────
	// Registered on the document, but gated on this table having exactly one
	// Selected cell — so a table the user hasn't clicked into never swallows a
	// keystroke meant for the note, and a multi-cell drag range (same
	// `.bt-selected` class) is left to the mouse-driven selection panel.
	// Ctrl/Cmd+V reads the system clipboard and pastes starting at the current
	// selection's own top-left corner (single Selected cell OR a multi-cell
	// drag range — both share `sel`), reusing the exact same parsing a
	// single-cell edit-mode paste already does (renderEditMode.ts) — an HTML
	// <table> (Excel/Sheets, or a copy made via the selection panel's own
	// "Copy to Excel" button) takes priority, including reconstructing any
	// merges its rowspan/colspan implies (parseHtmlTableWithMerges), falling
	// back to a Markdown pipe table in plain text. Reported as pressing it
	// while cells were merely selected (not being individually edited) doing
	// nothing at all.
	const pasteAtSelection = async (r1: number, c1: number): Promise<void> => {
		let html = '', text = '';
		try {
			const items = await activeWindow.navigator.clipboard.read();
			for (const item of items) {
				if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
				if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
			}
		} catch {
			new Notice(t('pasteFailed'));
			return;
		}
		const parsed = /<table[\s>]/i.test(html) ? parseHtmlTableWithMerges(html) : null;
		const values = parsed?.values ?? parseMarkdownPipeTable(text);
		if (!values) return;
		const anchorColId = colId(model, c1);
		if (!anchorColId) return;
		// A selection anchored on the header row has no "data row" to paste
		// into — the same table-format-conversion op a header cell's own
		// edit-mode paste already uses (renderCell.ts's onPasteGridHeader),
		// values-only: a merge landing in the row that BECOMES the header has
		// no well-defined shape once that row stops being a data row at all.
		if (r1 === 0) {
			edits.run({ type: 'paste-values-with-header', anchorColId, values });
			return;
		}
		const anchorRowId = rowId(model, r1);
		if (!anchorRowId) return;
		edits.run({ type: 'paste-values', anchorRowId, anchorColId, values, merges: parsed?.merges });
	};

	component.registerDomEvent(activeDocument, 'keydown', (evt: KeyboardEvent) => {
		if (!sel.start || !sel.end) return;
		if (!table.isConnected) return;

		// An open editor owns these keys itself (renderEditMode.ts) — including
		// its own native copy/paste of whatever text is selected inside it.
		// What identifies that case is where the event CAME FROM — not whether
		// the table currently carries `.bt-editing`, which is mutable state
		// that has already changed by the time this listener runs: a microtask
		// checkpoint happens after every event-listener callback returns, so
		// the editor's own handler has not only run but its deferred commit has
		// too — dropping `.bt-editing` and setting the selection — before this
		// same keystroke finishes bubbling here. Reading the class would
		// therefore see "not editing", treat the Enter the editor just consumed
		// as a fresh command, and reopen the editor it just closed. (Same
		// family as the isConnected-inside-blur trap in CLAUDE.md: don't judge
		// an in-flight event by state that a microtask may already have
		// rewritten.)
		const target = evt.target as HTMLElement | null;
		if (target?.closest('.bt-cell-editor, .bt-date-input, .bt-inline-editor')) return;

		// Paste applies to BOTH a single Selected cell and a multi-cell drag
		// range — everything else below this block is single-cell-only (see
		// the row/col-equality check right after it). Copy is deliberately
		// NOT bound to Ctrl/Cmd+C here — with the multi-cell selection panel
		// open (the common case for copying a range), something ahead of this
		// listener in the real app (outside this plugin's own DOM — Obsidian's
		// own Live Preview/CodeMirror editor the block sits inside is the
		// likely source) already consumes it, so this would be dead code
		// pretending to work. The panel's own "Copy to Excel"/"Copy as
		// Markdown" buttons are the one reliable way to copy a range; Ctrl+V
		// here is what makes pasting it back in feel keyboard-driven end-to-end.
		if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && evt.key.toLowerCase() === 'v' && edits.canAny(['paste-values', 'paste-values-with-header'])) {
			const rect = effectiveSelRect();
			if (rect) {
				evt.preventDefault();
				void pasteAtSelection(rect.r1, rect.c1);
			}
			return;
		}

		if (sel.start.row !== sel.end.row || sel.start.col !== sel.end.col) return;
		const current = sel.start;

		// A choice column's value menu renders to document.body, outside `table` —
		// so there's no cell class to find it by (renderHoverPin.ts tracks it
		// instead). Tab closes it without picking a value and carries on, matching
		// what Tab does out of a text or date editor; everything else is left to
		// Obsidian's own Menu, which already handles ↑/↓ and Enter/Escape.
		const activeMenu = getActiveCellMenu();
		if (activeMenu && activeMenu.row === current.row && activeMenu.col === current.col) {
			if (evt.key === 'Tab') {
				evt.preventDefault();
				activeMenu.close();
				selectCell(moveCell(model, occupied, current, evt.shiftKey ? 'left' : 'right'));
			}
			return;
		}

		if (evt.key === 'Tab') {
			evt.preventDefault();
			selectCell(moveCell(model, occupied, current, evt.shiftKey ? 'left' : 'right'));
			return;
		}
		if (evt.key === 'ArrowUp')    { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'up'));    return; }
		if (evt.key === 'ArrowDown')  { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'down'));  return; }
		if (evt.key === 'ArrowLeft')  { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'left'));  return; }
		if (evt.key === 'ArrowRight') { evt.preventDefault(); selectCell(moveCell(model, occupied, current, 'right')); return; }

		// Clear the cell in place, without opening an editor — spreadsheet standard.
		if (evt.key === 'Backspace' || evt.key === 'Delete') {
			evt.preventDefault();
			if (!edits.can(current.row === 0 ? 'set-col-name' : 'set-cell-content')) return;
			const currentValue = current.row === 0
				? (model.columns[current.col]?.name ?? '')
				: resolveCellValue(model, rowId(model, current.row), colId(model, current.col));
			if (currentValue !== '') onCellChange(current.row, current.col, '');
			return;
		}

		// Enter opens the editor keeping the current content; any printable
		// character opens it seeded with just that character (i.e. replacing the
		// content, as Excel/Sheets do). Modifier combos are left to Obsidian.
		if (evt.key === 'Enter' || (evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey)) {
			const cellEl = table.querySelector<HTMLElement>(`[data-row="${current.row}"][data-col="${current.col}"]`);
			if (!cellEl) return;
			evt.preventDefault();
			triggerPrimaryAction(cellEl, evt.key === 'Enter' ? undefined : evt.key);
		}
	});
}
