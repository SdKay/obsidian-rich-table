import type { SheetDefV2, TableModelV2, WorkbookV3 } from './model';
import { genId } from './idGen';

/**
 * Structural operations on a WORKBOOK (the sheet list itself) — the sheet-axis
 * counterpart to `StructuralOpV2` in operations.ts, which operates on a single
 * sheet's own data. Kept as a separate type/reducer (not folded into
 * `StructuralOpV2`) because it takes a different argument (`WorkbookV3`, not a
 * `TableModelV2`) — every one of these ops changes WHICH sheets exist or which
 * one is active, never a sheet's own columns/rows/styles/etc.
 */
export type WorkbookOpV2 =
	/** Appends a brand-new, genuinely empty sheet (zero columns) at the end and
	 *  switches to it — tableBlock.ts renders an empty active sheet with the
	 *  same "insert template / insert blank table" banner a brand-new code
	 *  block shows, via `set-sheet-content` once the user picks one. */
	| { type: 'create-sheet' }
	| { type: 'delete-sheet';   sheetId: string }
	| { type: 'rename-sheet';   sheetId: string; name: string }
	/** Drag-reorder the tab strip — same "id array, bail on mismatch" pattern
	 *  as `reorder-rows`/`reorder-aggregate` in operations.ts. */
	| { type: 'reorder-sheets'; sheetIds: string[] }
	| { type: 'set-active-sheet'; sheetId: string }
	| { type: 'set-sheet-tab-style'; sheetId: string; tabColor: string | null; tabTextColor: string | null }
	/** Replaces an (expected-to-be-empty) sheet's own data wholesale — used to
	 *  populate a freshly-created sheet from the demo template or a blank
	 *  row×col grid, the per-sheet analogue of `insertTemplate`/`insertBlank`
	 *  (tableBlock.ts) for a brand-new whole code block. Keeps the sheet's own
	 *  identity (id/name/tabColor) untouched — only its TableModelV2 fields
	 *  are replaced. */
	| { type: 'set-sheet-content'; sheetId: string; content: Omit<TableModelV2, 'version'> };

export function applyWorkbookOp(workbook: WorkbookV3, op: WorkbookOpV2): void {
	switch (op.type) {
		case 'create-sheet': {
			const existing = new Set(workbook.sheets.map(s => s.id));
			const sheet: SheetDefV2 = { id: genId('s', existing), version: 2, columns: [], rows: [], merges: [], styles: [] };
			workbook.sheets.push(sheet);
			workbook.activeSheetId = sheet.id;
			break;
		}
		case 'delete-sheet': {
			const idx = workbook.sheets.findIndex(s => s.id === op.sheetId);
			if (idx < 0) break;
			workbook.sheets.splice(idx, 1);
			if (workbook.activeSheetId === op.sheetId) {
				// Fall back to whatever now sits at the same position, else the
				// previous one, else (if the workbook is now empty) leave it
				// dangling — tableBlock.ts handles the zero-sheets case separately
				// by collapsing the whole block back to empty, at which point
				// activeSheetId is moot.
				workbook.activeSheetId = workbook.sheets[idx]?.id ?? workbook.sheets[idx - 1]?.id;
			}
			break;
		}
		case 'rename-sheet': {
			const sheet = workbook.sheets.find(s => s.id === op.sheetId);
			if (sheet) sheet.name = op.name;
			break;
		}
		case 'reorder-sheets': {
			const byId = new Map(workbook.sheets.map(s => [s.id, s]));
			const reordered = op.sheetIds.map(id => byId.get(id)).filter((s): s is SheetDefV2 => !!s);
			if (reordered.length !== workbook.sheets.length) break; // id set mismatch — bail rather than drop sheets
			workbook.sheets = reordered;
			break;
		}
		case 'set-active-sheet': {
			if (workbook.sheets.some(s => s.id === op.sheetId)) workbook.activeSheetId = op.sheetId;
			break;
		}
		case 'set-sheet-tab-style': {
			const sheet = workbook.sheets.find(s => s.id === op.sheetId);
			if (!sheet) break;
			if (op.tabColor !== null) sheet.tabColor = op.tabColor; else delete sheet.tabColor;
			if (op.tabTextColor !== null) sheet.tabTextColor = op.tabTextColor; else delete sheet.tabTextColor;
			break;
		}
		case 'set-sheet-content': {
			const sheet = workbook.sheets.find(s => s.id === op.sheetId);
			if (!sheet) break;
			Object.assign(sheet, op.content);
			break;
		}
	}
}
