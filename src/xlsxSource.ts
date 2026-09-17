/**
 * Converts an external .xlsx file's bytes into the SAME model shapes
 * (`TableModelV2` / `WorkbookV3`) `renderTable()` already knows how to
 * render — view-only for now (see `TableModelV2.xlsxSource`'s own doc
 * comment): the result is handed straight to `renderTable()` with no
 * `onOp`, the same "read but don't offer to write back" treatment a
 * `locked` table gets, and it is never itself serialized back into the
 * code block.
 *
 * xlsx has no notion of a stable row/column ID (or of a header row at all —
 * that's purely a rich-table concept) — every ID here is a plain,
 * position-derived string (`r_<1-based row number>`, `c_<1-based col
 * number>`), regenerated fresh on every read. That's fine specifically
 * because nothing here is ever written back: there is no persisted
 * reference (merge/style target, formula, view) that needs those IDs to
 * survive across a re-read the way an authored rich-table block's IDs do.
 *
 * Row 1 becomes the header (`columns[].name`), rows 2+ become `rows[]` —
 * not because xlsx has any such structural distinction (it doesn't; every
 * row is equally a data row), but because it's what makes the freeze-pane
 * mapping below come out clean: Excel's `ySplit` counts frozen rows from
 * the very top, INCLUDING whatever the user treats as their header, while
 * `TableModelV2.freezeRows` counts rows frozen IN ADDITION TO the header
 * (which is always effectively frozen already). Treating row 1 as the
 * header makes `freezeRows = ySplit - 1` line up exactly with "the user
 * froze just their header row" — the single most common real-world case —
 * without a special case. A sheet with no real header row still renders
 * correctly this way; it just shows an empty-looking header, no worse than
 * xlsx's own lack of a header concept would otherwise look.
 */
import { loadWorkbook, fromArrayBuffer, workbookToBytes } from '@office-kit/xlsx/io';
import { getCellFont, getCellFill } from '@office-kit/xlsx/styles';
import { getCell, setCell, deleteCell, mergeCells, unmergeCellsAt } from '@office-kit/xlsx/worksheet';
import type { Workbook } from '@office-kit/xlsx/workbook';
import type { Worksheet } from '@office-kit/xlsx/worksheet';
import type { Cell, CellValue } from '@office-kit/xlsx/cell';
import type { ColumnDefV2, MergeRangeV2, RowDefV2, SheetDefV2, StyleRuleV2, TableModelV2, WorkbookV3 } from './model';

const rowId = (n: number): string => `r_${n}`;
const colId = (n: number): string => `c_${n}`;

/** `Color.rgb` is 8-hex ARGB (alpha first); rich-table's style fields are
 *  plain CSS colors. Alpha is dropped rather than translated to `rgba()` —
 *  cell fill/font colors in real spreadsheets are overwhelmingly opaque
 *  (alpha `FF`, or `00` in some writers' output — never a real translucency
 *  the user intended), and preserving true alpha isn't a field rich-table's
 *  style model has any way to render distinctly from opaque. */
function argbToHex(argb: string | undefined): string | undefined {
	if (!argb) return undefined;
	const hex = argb.length === 8 ? argb.slice(2) : argb;
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined; // theme/indexed colors: not resolved in phase 1, see README
	return `#${hex.toLowerCase()}`;
}

/** Renders every `CellValue` variant to the plain string rich-table cells
 *  are always made of. Formula cells show their last-cached result (view-
 *  only — there is no formula ENGINE here, only whatever Excel last computed
 *  and saved); rich-text runs are flattened to plain concatenated text,
 *  losing per-run formatting (documented gap, same tier as borders/number
 *  formats — see the feature's own README/CLAUDE.md notes). */
function cellValueToString(value: CellValue): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if ('kind' in value) {
		switch (value.kind) {
			case 'duration': {
				const totalSeconds = Math.round(value.ms / 1000);
				const h = Math.floor(totalSeconds / 3600);
				const m = Math.floor((totalSeconds % 3600) / 60);
				const s = totalSeconds % 60;
				return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
			}
			case 'error':
				return value.code;
			case 'rich-text':
				return value.runs.map(r => r.text).join('');
			case 'formula': {
				const cached = value.cachedValue;
				if (cached === undefined) return '';
				if (typeof cached === 'boolean') return cached ? 'TRUE' : 'FALSE';
				return String(cached);
			}
		}
	}
	return '';
}

/** Excel character-unit column width → px. The `*7 + 5` factor is the
 *  widely-used approximation for the default Calibri 11 grid (Excel's own
 *  width unit is defined relative to the workbook's default font, which
 *  this doesn't otherwise account for) — close enough for a view-only
 *  render, not represented as exact. */
export function colWidthToPx(width: number | undefined): number | undefined {
	return width === undefined ? undefined : Math.round(width * 7 + 5);
}

/** Row height is in points (1/72in); rich-table's is px (96dpi). */
function rowHeightToPx(height: number | undefined): number | undefined {
	return height === undefined ? undefined : Math.round(height * (96 / 72));
}

/** True if a resolved font/fill actually differs from "no style at all" —
 *  guards against emitting a `StyleRuleV2` for every single cell just
 *  because it has SOME resolved style object (every cell does, even
 *  Excel's own default). Only what's visibly different is worth a rule. */
function buildStyleRule(wb: Workbook, cell: Cell): Omit<StyleRuleV2, 'target'> | null {
	const font = getCellFont(wb, cell);
	const fill = getCellFill(wb, cell);
	const rule: Omit<StyleRuleV2, 'target'> = {};
	if (font.bold) rule.bold = true;
	if (font.italic) rule.italic = true;
	const color = argbToHex(font.color?.rgb);
	if (color && color !== '#000000') rule.color = color;
	if (font.size && font.size !== 11) rule.size = Math.round(font.size * (96 / 72)); // pt -> px, same unit as colWidthToPx/rowHeightToPx
	if (fill.kind === 'pattern' && fill.patternType === 'solid') {
		const bg = argbToHex(fill.fgColor?.rgb);
		if (bg) rule.bg = bg;
	}
	return Object.keys(rule).length > 0 ? rule : null;
}

/** A ColumnDimension entry is a genuine "this specific column was set" record
 *  only when its range is a single column (`min === max`) — real xlsx files
 *  routinely also carry a "default width" entry spanning a huge range (often
 *  1..16384, the full column limit) meaning "everything not explicitly
 *  overridden uses this width", which is a fallback, not a real column count.
 *  Used both to find a column's own explicit width (below) and to bound
 *  `usedBounds`'s maxCol — trusting a wide fallback range's `max` there was a
 *  confirmed bug: any sheet carrying one rendered 16384 columns. */
function isSingleColumnDimension(dim: { min: number; max: number }): boolean {
	return dim.min === dim.max;
}

/** Resolves the width that actually applies to column `c` — the covering
 *  entry with the SMALLEST span, not merely the first one found. Real xlsx
 *  files commonly register a wide "default width" range (see
 *  isSingleColumnDimension's doc comment) alongside specific single-column
 *  overrides; `Array.prototype.find()`'s "first match wins" only happened to
 *  pick the right one when the specific entry was inserted before the wide
 *  one — reported (and reproduced) with the opposite ordering, where a
 *  narrow-content column rendered wide and a wide-content column rendered
 *  narrow, i.e. two columns' widths landing swapped relative to Excel. */
function resolveColumnWidth(sheet: Worksheet, c: number): number | undefined {
	let best: { min: number; max: number; width?: number } | undefined;
	for (const dim of sheet.columnDimensions.values()) {
		if (c < dim.min || c > dim.max) continue;
		if (!best || (dim.max - dim.min) < (best.max - best.min)) best = dim;
	}
	return best?.width;
}

function usedBounds(sheet: Worksheet): { maxRow: number; maxCol: number } {
	let maxRow = 0;
	let maxCol = 0;
	for (const [r, cols] of sheet.rows) {
		if (cols.size === 0) continue;
		maxRow = Math.max(maxRow, r);
		for (const c of cols.keys()) maxCol = Math.max(maxCol, c);
	}
	for (const dim of sheet.columnDimensions.values()) {
		if (isSingleColumnDimension(dim)) maxCol = Math.max(maxCol, dim.max);
	}
	for (const rowNum of sheet.rowDimensions.keys()) maxRow = Math.max(maxRow, rowNum);
	return { maxRow, maxCol };
}

/** Converts one Worksheet into a plain `TableModelV2` (no `version`/`id` —
 *  callers attach whichever of those their own shape needs). */
function convertSheet(wb: Workbook, sheet: Worksheet): Omit<TableModelV2, 'version'> {
	const { maxRow, maxCol } = usedBounds(sheet);
	const headerRow = sheet.rows.get(1);

	const columns: ColumnDefV2[] = [];
	for (let c = 1; c <= maxCol; c++) {
		const headerCell = headerRow?.get(c);
		const name = headerCell ? cellValueToString(headerCell.value) : '';
		const col: ColumnDefV2 = { id: colId(c), name };
		const width = colWidthToPx(resolveColumnWidth(sheet, c));
		if (width !== undefined) col.width = width;
		columns.push(col);
	}

	const rows: RowDefV2[] = [];
	const styles: StyleRuleV2[] = [];
	for (let r = 2; r <= maxRow; r++) {
		const rowCells = sheet.rows.get(r);
		const cells: Record<string, string> = {};
		if (rowCells) {
			for (const [c, cell] of rowCells) {
				const text = cellValueToString(cell.value);
				if (text !== '') cells[colId(c)] = text;
				const rule = buildStyleRule(wb, cell);
				if (rule) styles.push({ target: `${rowId(r)}.${colId(c)}`, ...rule });
			}
		}
		const row: RowDefV2 = { id: rowId(r), cells };
		const height = rowHeightToPx(sheet.rowDimensions.get(r)?.height);
		if (height !== undefined) row.height = height;
		rows.push(row);
	}

	// Header cells' own styles, same rule-building, targeted at "header.c_x"
	// instead of "r_y.c_x" (see styleTarget.ts's grammar).
	if (headerRow) {
		for (const [c, cell] of headerRow) {
			const rule = buildStyleRule(wb, cell);
			if (rule) styles.push({ target: `header.${colId(c)}`, ...rule });
		}
	}

	const merges: MergeRangeV2[] = sheet.mergedCells.map(m => ({
		anchor: `${m.minRow === 1 ? 'header' : rowId(m.minRow)}.${colId(m.minCol)}`,
		end: `${rowId(Math.max(m.maxRow, 2))}.${colId(m.maxCol)}`,
	}));

	const model: Omit<TableModelV2, 'version'> = { columns, rows, merges, styles };

	const pane = sheet.views[0]?.pane;
	if (pane?.state === 'frozen' || pane?.state === 'frozenSplit') {
		if (pane.ySplit !== undefined && pane.ySplit > 0) model.freezeRows = Math.max(0, pane.ySplit - 1);
		if (pane.xSplit !== undefined && pane.xSplit > 0) model.freezeCols = pane.xSplit;
	}

	return model;
}

/**
 * Reads a .xlsx file's bytes and returns either a single-sheet
 * `TableModelV2` (when `sheetName` is given, or the file has exactly one
 * visible sheet) or a `WorkbookV3` covering every visible sheet — see the
 * feature's own README for why "how many sheets does the RESULT have" is
 * governed by this rule rather than always producing one shape.
 */
export async function readXlsxAsModel(
	bytes: ArrayBuffer | Uint8Array,
	sheetName?: string,
): Promise<TableModelV2 | WorkbookV3> {
	const wb = await loadWorkbook(fromArrayBuffer(bytes));
	const visible = wb.sheets.filter(s => s.kind === 'worksheet' && s.state === 'visible');

	if (sheetName) {
		const entry = visible.find(s => s.kind === 'worksheet' && s.sheet.title === sheetName);
		if (!entry || entry.kind !== 'worksheet') throw new Error(`Sheet "${sheetName}" not found`);
		return { version: 2, ...convertSheet(wb, entry.sheet) };
	}

	if (visible.length <= 1) {
		const only = visible[0];
		if (!only || only.kind !== 'worksheet') return { version: 2, columns: [], rows: [], merges: [], styles: [] };
		return { version: 2, ...convertSheet(wb, only.sheet) };
	}

	const sheets: SheetDefV2[] = visible.map((entry, i) => {
		if (entry.kind !== 'worksheet') throw new Error('unreachable: filtered to worksheet kind above');
		return { id: `s_${i + 1}`, version: 2, name: entry.sheet.title, ...convertSheet(wb, entry.sheet) };
	});
	return { version: 3, activeSheetId: sheets[0]!.id, sheets };
}

/**
 * Phase 1 of xlsx WRITE support (see CLAUDE.md's "xlsx write support" section
 * for the full design discussion): only cell-content edits and merge/unmerge
 * are safe to send back into the real file — every other StructuralOpV2
 * variant (sort, style, freeze, column type, …) has no honest xlsx
 * equivalent, or would need UI work this phase doesn't include. Callers must
 * filter to this subset (`isXlsxWritableOp`) before calling `writeXlsxOps` —
 * this module has no access to the rest of a StructuralOpV2 batch to filter
 * it itself.
 */
export type XlsxWritableOp =
	| { type: 'set-cell-content'; rowId: string; colId: string; value: string }
	| { type: 'set-col-name'; colId: string; name: string }
	| { type: 'merge-cells'; anchorRowId: string; anchorColId: string; endRowId: string; endColId: string }
	| { type: 'unmerge-cells'; anchorRowId: string; anchorColId: string };

const XLSX_WRITABLE_OP_TYPES: ReadonlySet<string> = new Set(['set-cell-content', 'set-col-name', 'merge-cells', 'unmerge-cells']);

export function isXlsxWritableOp(op: { type: string }): op is XlsxWritableOp {
	return XLSX_WRITABLE_OP_TYPES.has(op.type);
}

/** Inverse of `rowId`/`colId` above — 'header' and `r_<n>`/`c_<n>` map back
 *  to the exact same 1-based xlsx coordinates convertSheet read them from. */
function xlsxRowFromId(id: string): number {
	return id === 'header' ? 1 : Number(id.slice(2));
}
function xlsxColFromId(id: string): number {
	return Number(id.slice(2));
}

/** Excel's own "General" format auto-detect, used only as a fallback when the
 *  original cell's type can't be preserved (see `coerceCellValue`) — no date
 *  detection, since Excel's own date parsing is locale-dependent and a wrong
 *  guess is worse than leaving typed text as text. */
function autoDetectGeneral(text: string): CellValue {
	if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
	const n = Number(text);
	if (text.trim() !== '' && Number.isFinite(n)) return n;
	return text;
}

/** Coerces freshly-typed plain text back into a CellValue, preferring to keep
 *  the ORIGINAL cell's type (number/boolean/date) and falling back to Excel's
 *  "General" auto-detect only when the new text can't be parsed as that type
 *  (or there was no original cell to match) — see CLAUDE.md's "xlsx write
 *  support" section for the full reasoning. */
function coerceCellValue(existing: CellValue | undefined, text: string): CellValue {
	if (typeof existing === 'number') {
		const n = Number(text);
		if (text.trim() !== '' && Number.isFinite(n)) return n;
	} else if (typeof existing === 'boolean') {
		if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
	} else if (existing instanceof Date) {
		const d = new Date(text);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return autoDetectGeneral(text);
}

/** Writes plain edited text into one xlsx cell: empty clears it outright,
 *  leading `=` (Excel's own convention) makes it a new formula — replacing
 *  whatever was there before, formula or not — and everything else goes
 *  through `coerceCellValue`. Never touches `styleId`/`hyperlinkId` (setCell's
 *  own no-override-means-keep behaviour), so a cell's look survives a content
 *  edit untouched. */
function setPlainCellContent(sheet: Worksheet, row: number, col: number, text: string): void {
	if (text === '') { deleteCell(sheet, row, col); return; }
	if (text.startsWith('=') && text.length > 1) {
		setCell(sheet, row, col, { kind: 'formula', formula: text.slice(1), t: 'normal' });
		return;
	}
	setCell(sheet, row, col, coerceCellValue(getCell(sheet, row, col)?.value, text));
}

function resolveWritableWorksheet(wb: Workbook, sheetName: string | undefined): Worksheet {
	const visible = wb.sheets.filter(s => s.kind === 'worksheet' && s.state === 'visible');
	const entry = sheetName
		? visible.find(s => s.kind === 'worksheet' && s.sheet.title === sheetName)
		: visible[0];
	if (!entry || entry.kind !== 'worksheet') throw new Error(sheetName ? `Sheet "${sheetName}" not found` : 'No visible worksheet');
	return entry.sheet;
}

/** Mutates a loaded Workbook in place per a batch of `XlsxWritableOp` — the
 *  exact coordinate mapping `convertSheet` used to read the file, run in
 *  reverse. */
export function applyXlsxWritableOps(wb: Workbook, sheetName: string | undefined, ops: readonly XlsxWritableOp[]): void {
	const sheet = resolveWritableWorksheet(wb, sheetName);
	for (const op of ops) {
		switch (op.type) {
			case 'set-cell-content':
				setPlainCellContent(sheet, xlsxRowFromId(op.rowId), xlsxColFromId(op.colId), op.value);
				break;
			case 'set-col-name':
				// Header text lives in xlsx row 1 — same convention convertSheet reads it with.
				setPlainCellContent(sheet, 1, xlsxColFromId(op.colId), op.name);
				break;
			case 'merge-cells': {
				const r1 = xlsxRowFromId(op.anchorRowId);
				const c1 = xlsxColFromId(op.anchorColId);
				const r2 = xlsxRowFromId(op.endRowId);
				const c2 = xlsxColFromId(op.endColId);
				mergeCells(sheet, {
					minRow: Math.min(r1, r2), minCol: Math.min(c1, c2),
					maxRow: Math.max(r1, r2), maxCol: Math.max(c1, c2),
				});
				break;
			}
			case 'unmerge-cells':
				unmergeCellsAt(sheet, xlsxRowFromId(op.anchorRowId), xlsxColFromId(op.anchorColId));
				break;
		}
	}
}

/** Read → mutate → re-serialize in one call — the whole of phase 1's write
 *  path. Re-reads fresh bytes rather than reusing any previously-loaded
 *  Workbook, matching how the rest of this plugin always re-derives from the
 *  vault's current on-disk content rather than caching a live in-memory
 *  object across writes. */
export async function writeXlsxOps(
	bytes: ArrayBuffer | Uint8Array,
	sheetName: string | undefined,
	ops: readonly XlsxWritableOp[],
): Promise<Uint8Array> {
	const wb = await loadWorkbook(fromArrayBuffer(bytes));
	applyXlsxWritableOps(wb, sheetName, ops);
	return workbookToBytes(wb);
}
