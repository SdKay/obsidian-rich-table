export interface ColumnDef {
	name: string;
	hidden?: boolean;
	type?: string;
	width?: number;
	align?: 'left' | 'center' | 'right';
}

/** 0-indexed: row 0 = header row, col 0 = column A */
export interface MergeRange {
	startRow: number;
	startCol: number;
	endRow: number;
	endCol: number;
}

/**
 * target uses 1-indexed Excel-style notation:
 *   "A1"   single cell (col A, row 1 = header)
 *   "A1:B3" range
 *   "B*"   whole column B
 *   "*2"   whole row 2
 *   "1:3"  row range 1 to 3
 */
export interface StyleRule {
	target: string;
	bg?: string;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	size?: number;
}

/**
 * rows[0] = header row (column display names)
 * rows[1..n] = data rows
 * All arrays are 0-indexed.
 */
export interface TableModel {
	title?: string;
	columns: ColumnDef[];
	rows: string[][];
	merges: MergeRange[];
	styles: StyleRule[];
	hiddenRows?: number[]; // 0-indexed model row indices (0 = header, never hidden)
	rowHeights?: number[]; // per-row min-height in px, 0-indexed (0 = header)
	footer?: string | string[];
	/** Active column filters: key = column letter (e.g. "B"), value = values to SHOW */
	filter?: Record<string, string[]>;
	/** When true, all graphical editing is disabled in edit/live-preview mode.
	 *  The lock button at the top-right corner toggles this field. */
	locked?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 model — ID-based, pipe table is a generated read-only mirror
// ─────────────────────────────────────────────────────────────────────────────

/** Column definition for v2 (adds stable `id`). */
export interface ColumnDefV2 {
	id: string;
	name: string;
	hidden?: boolean;
	type?: string;
	width?: number;
	align?: 'left' | 'center' | 'right';
	/** Values to SHOW for this column (empty/absent = no filter). Lives on the
	 *  column itself — deleting the column drops its filter for free. */
	filter?: string[];
}

/**
 * Data row for v2.  Does NOT include the header row — headers are derived
 * from `columns[].name` and never stored in rows[].
 * Missing colId keys in `cells` are treated as empty string "".
 */
export interface RowDefV2 {
	id: string;
	hidden?: boolean;
	height?: number;
	cells: Record<string, string>; // colId → cell content (always string)
}

/** Merge range for v2, referenced by row/col IDs. */
export interface MergeRangeV2 {
	anchor: string; // "rowId.colId"  — top-left origin
	end:    string; // "rowId.colId"  — bottom-right extent
}

/**
 * Style rule for v2.  `target` is an ID-based string:
 *   "r_abc"                        whole row
 *   "c_abc"                        whole column
 *   "r_abc.c_def"                  single cell
 *   "r_abc:r_xyz"                  row range
 *   "c_abc:c_xyz"                  column range
 *   "r_abc.c_def:r_xyz.c_ghi"     rectangle
 */
export interface StyleRuleV2 {
	target: string;
	bg?: string;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	size?: number;
}

/** Full table model for v2. */
export interface TableModelV2 {
	version: 2;
	title?: string;
	columns: ColumnDefV2[];
	rows: RowDefV2[];                    // data rows only — no header
	merges: MergeRangeV2[];
	styles: StyleRuleV2[];
	footer?: string | string[];
	locked?: boolean;
	theme?: string;   // e.g. 'academic' | 'plain' — absent = default (see src/themes/)
	/** When true, only the title (if any) and header row render; body and footer are hidden. */
	collapsed?: boolean;
	/** Display-only row sort — never reorders `rows[]` itself, applied at render time. */
	sort?: { colId: string; dir: 'asc' | 'desc' };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ChoiceOption {
	value: string;
	label?: string;
	color?: string;
}

export interface ChoiceType {
	id: string;
	options: ChoiceOption[];
}

export interface BetterTableSettings {
	customChoices: ChoiceType[];
	/**
	 * When false (default), all interactive behaviour (hover strips, click-to-edit,
	 * double-click panels, choice dropdowns) is disabled in Obsidian's reading view.
	 * Live preview / source mode is never affected by this setting.
	 */
	allowReadingViewEdit: boolean;
}
