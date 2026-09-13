/**
 * Converts a native (non xlsx-backed) rich-table's model into a fresh .xlsx
 * file's bytes — the write-side mirror of `xlsxSource.ts`'s read path, going
 * the OPPOSITE direction: there, a `Worksheet` becomes a `TableModelV2`; here,
 * a `TableModelV2`/`WorkbookV3` becomes a brand-new `Worksheet`. This never
 * reads an existing file — every call starts from `createWorkbook()`, unlike
 * `xlsxSource.ts`'s `writeXlsxOps`, which patches an already-loaded one.
 *
 * Same coordinate convention as `xlsxSource.ts`, applied in reverse: xlsx row
 * 1 = the header, model row `rows[i]` = xlsx row `i + 2`; xlsx column `c` (1-
 * based) = model column `columns[c - 1]`. The header sentinel `"header"` used
 * throughout `MergeRangeV2`/`StyleRuleV2` targets maps to xlsx row 1, exactly
 * as `resolveMergeRowIndex`'s `-1` sentinel (`operations.ts`) already treats
 * it one position before the first data row.
 */
import { createWorkbook, addWorksheet } from '@office-kit/xlsx/workbook';
import { setCell, mergeCells, setColumnWidth, setRowHeight } from '@office-kit/xlsx/worksheet';
import { setCellBackgroundColor, setFontColor, setBold, setItalic, setFontSize } from '@office-kit/xlsx/styles';
import { workbookToBytes } from '@office-kit/xlsx/io';
import type { Workbook } from '@office-kit/xlsx/workbook';
import type { Worksheet } from '@office-kit/xlsx/worksheet';
import type { Cell } from '@office-kit/xlsx/cell';
import { resolveStylesV2, resolveHeaderStylesV2, type ResolvedStyleV2 } from './styleTarget';
import { sheetFallbackName } from './i18n';
import { displayLen } from './serializer';
import type { ColumnDefV2, RowDefV2, SheetDefV2, TableModelV2, WorkbookV3 } from './model';

/** Inverse of `xlsxSource.ts`'s `colWidthToPx` (`width*7+5`). */
function pxToColWidth(px: number): number {
	return Math.max(0, (px - 5) / 7);
}

/** Inverse of `xlsxSource.ts`'s `rowHeightToPx` (`height * 96/72`). */
function pxToRowHeightPt(px: number): number {
	return px * (72 / 96);
}

/** Inverse of `xlsxSource.ts`'s font-size conversion (`pt * 96/72`). */
function pxToFontSizePt(px: number): number {
	return px * (72 / 96);
}

/** A resolved rich-table color is `#rrggbb`; the xlsx styling API wants a bare
 *  6/8-hex ARGB string with no leading `#` (confirmed: `normaliseRgb` throws
 *  on one). */
function stripHash(hex: string): string {
	return hex.startsWith('#') ? hex.slice(1) : hex;
}

function applyResolvedStyleToCell(wb: Workbook, cell: Cell, rs: ResolvedStyleV2): void {
	if (rs.bg) setCellBackgroundColor(wb, cell, stripHash(rs.bg));
	if (rs.color) setFontColor(wb, cell, stripHash(rs.color));
	if (rs.bold) setBold(wb, cell, true);
	if (rs.italic) setItalic(wb, cell, true);
	if (rs.size) setFontSize(wb, cell, pxToFontSizePt(rs.size));
}

/** Excel's own default row height in points, for a single line of default-
 *  size (11pt Calibri) text — used as the per-line unit when a row's content
 *  spans multiple lines (see `estimateRowHeightPt`). Matches the built-in
 *  default `Worksheet.rowDimensions` has nothing for; not imported from
 *  anywhere since the library doesn't expose it as a named constant. */
const DEFAULT_ROW_HEIGHT_PT = 15;

/** Extra character-width padding added on top of the longest line's own
 *  `displayLen` — Excel's default Calibri-11 column-width unit is roughly
 *  "one digit character," and a column sized to EXACTLY its content's length
 *  clips the last character/renders with zero breathing room (confirmed:
 *  Excel's own auto-fit-column-width leaves similar headroom). */
const COLUMN_WIDTH_PADDING = 2;

/** Floor/ceiling for an ESTIMATED column width (character units) — a floor
 *  so a column of all-empty/very-short cells doesn't collapse to an
 *  unreadable sliver, a ceiling so one outlier cell (a long formula result,
 *  a paragraph typed into a single line) doesn't blow the sheet's zoom level
 *  out. Deliberately NOT applied to a column with its OWN explicit
 *  `ColumnDefV2.width` — the user already chose that value; only the
 *  estimate has to guard against extremes it can't otherwise judge. */
const MIN_ESTIMATED_COLUMN_WIDTH = 8;
const MAX_ESTIMATED_COLUMN_WIDTH = 80;

/** The widest line's `displayLen` across a cell's value — a multi-line cell
 *  (`\n`-separated, same convention `renderCell.ts` renders literally) should
 *  size its column by whichever of its own lines is longest, not the whole
 *  string's raw length (which would double-count the newlines and badly
 *  overestimate a short-but-tall cell). */
function widestLineLen(value: string): number {
	let widest = 0;
	for (const line of value.split('\n')) widest = Math.max(widest, displayLen(line));
	return widest;
}

/** Estimates a column's width from its own content — the header name and
 *  every data cell's value — when the model has no explicit width for it
 *  (see `writeModelIntoSheet`'s own call site: an explicit `ColumnDefV2.width`
 *  always wins outright, this is only the fallback). Reported: without this,
 *  every column landed at Excel's flat default width regardless of content,
 *  clipping anything longer than ~8 characters and leaving short columns
 *  needlessly wide — this is xlsxExport.ts's write-side answer to the same
 *  problem xlsxSource.ts's read-side `colWidthToPx` solves in reverse (there,
 *  a REAL xlsx column width converts to px; here, there is no real width to
 *  convert, so one is estimated from what's actually in the column instead —
 *  deliberately NOT a measurement of the live Obsidian DOM, which a workbook
 *  export needs to run for every sheet including ones not currently on
 *  screen at all, see this module's own header comment on `SheetDefV2`). */
function estimateColumnWidth(model: TableModelV2, col: ColumnDefV2): number {
	let widest = displayLen(col.name);
	for (const row of model.rows) widest = Math.max(widest, widestLineLen(row.cells[col.id] ?? ''));
	return Math.min(MAX_ESTIMATED_COLUMN_WIDTH, Math.max(MIN_ESTIMATED_COLUMN_WIDTH, widest + COLUMN_WIDTH_PADDING));
}

/** Estimates a row's height from how many lines its tallest cell spans —
 *  same no-explicit-value-set fallback shape as `estimateColumnWidth` above.
 *  A single-line row (the overwhelming majority) returns `undefined` rather
 *  than `DEFAULT_ROW_HEIGHT_PT` outright, so `writeModelIntoSheet` leaves
 *  `setRowHeight` uncalled and the row keeps the SHEET's own default height
 *  instead of being pinned to a specific number that happens to match it —
 *  only a genuinely multi-line row needs an explicit height at all. */
function estimateRowHeightPt(row: RowDefV2): number | undefined {
	let maxLines = 1;
	for (const value of Object.values(row.cells)) maxLines = Math.max(maxLines, value.split('\n').length);
	return maxLines > 1 ? maxLines * DEFAULT_ROW_HEIGHT_PT : undefined;
}

/** `MergeRangeV2.anchor`/`.end` are `"rowId.colId"` strings, `"header"` being
 *  the literal sentinel for the header row (see this module's own doc
 *  comment) — resolves straight to 1-based xlsx (row, col), or `null` if
 *  either endpoint no longer names a real row/column (shouldn't happen for a
 *  well-formed model, but a stale ID must not silently merge the wrong
 *  cells). */
function resolveAnchor(model: TableModelV2, anchor: string): { row: number; col: number } | null {
	const dot = anchor.indexOf('.');
	if (dot < 0) return null;
	const rowId = anchor.slice(0, dot);
	const colId = anchor.slice(dot + 1);
	const row = rowId === 'header' ? 1 : model.rows.findIndex(r => r.id === rowId) + 2;
	const col = model.columns.findIndex(c => c.id === colId) + 1;
	if (row < 1 || col < 1) return null;
	return { row, col };
}

/** Writes one `TableModelV2`'s columns/rows/merges/styles into a fresh
 *  `Worksheet` already added to `wb` — the per-sheet unit both
 *  `exportModelToXlsx` (single-sheet) and `exportWorkbookToXlsx` (one call
 *  per `SheetDefV2`) build on. */
function writeModelIntoSheet(wb: Workbook, ws: Worksheet, model: TableModelV2): void {
	model.columns.forEach((col, ci) => {
		const c = ci + 1;
		const headerCell = setCell(ws, 1, c, col.name);
		applyResolvedStyleToCell(wb, headerCell, resolveHeaderStylesV2(model.styles, col.id, model));
		// An explicit width (the user dragged this column) always wins; only a
		// column with none falls back to estimating one from its own content —
		// see estimateColumnWidth's own doc comment for why.
		setColumnWidth(ws, c, col.width ? pxToColWidth(col.width) : estimateColumnWidth(model, col));
	});

	model.rows.forEach((row, ri) => {
		const r = ri + 2;
		const heightPt = row.height ? pxToRowHeightPt(row.height) : estimateRowHeightPt(row);
		if (heightPt !== undefined) setRowHeight(ws, r, heightPt);
		model.columns.forEach((col, ci) => {
			const value = row.cells[col.id] ?? '';
			if (value === '') return; // leave genuinely empty cells unmaterialized, matching xlsxSource.ts's own read-side "" -> absent convention
			const cell = setCell(ws, r, ci + 1, value);
			applyResolvedStyleToCell(wb, cell, resolveStylesV2(model.styles, row.id, col.id, model));
		});
	});

	for (const merge of model.merges) {
		const start = resolveAnchor(model, merge.anchor);
		const end = resolveAnchor(model, merge.end);
		if (!start || !end) continue;
		mergeCells(ws, {
			minRow: Math.min(start.row, end.row), minCol: Math.min(start.col, end.col),
			maxRow: Math.max(start.row, end.row), maxCol: Math.max(start.col, end.col),
		});
	}
}

/** Exports a single-sheet table to a brand-new .xlsx file's bytes. */
export async function exportModelToXlsx(model: TableModelV2, sheetTitle: string): Promise<Uint8Array> {
	const wb = createWorkbook();
	const ws = addWorksheet(wb, sheetTitle);
	writeModelIntoSheet(wb, ws, model);
	return workbookToBytes(wb);
}

/** Rich-table itself never enforces sheet-name uniqueness (two tabs can share
 *  a name), but xlsx worksheet titles must be unique — appends " (2)", " (3)",
 *  … the same way Excel's own "duplicate sheet" disambiguation does, rather
 *  than letting a collision throw or silently overwrite the first sheet. */
function uniqueSheetTitle(used: Set<string>, base: string): string {
	let title = base;
	let n = 2;
	while (used.has(title)) title = `${base} (${n++})`;
	used.add(title);
	return title;
}

/** Exports every sheet of a multi-sheet workbook into one .xlsx file — one
 *  xlsx worksheet per `SheetDefV2`, in the same order they appear in
 *  `sheets[]`. A sheet with no explicit `name` gets the same 1-based
 *  "Sheet N" fallback the sheet-tab bar itself shows (`sheetFallbackName`),
 *  so the exported file's tab labels match what was on screen. */
export async function exportWorkbookToXlsx(workbook: WorkbookV3): Promise<Uint8Array> {
	const wb = createWorkbook();
	const usedTitles = new Set<string>();
	workbook.sheets.forEach((sheet: SheetDefV2, i) => {
		const title = uniqueSheetTitle(usedTitles, sheet.name || sheetFallbackName(i + 1));
		const ws = addWorksheet(wb, title);
		writeModelIntoSheet(wb, ws, sheet);
	});
	return workbookToBytes(wb);
}
