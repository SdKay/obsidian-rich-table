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

/** Aggregate/summary-row statistic types, computed over a column's visible cells. */
export type AggType = 'sum' | 'avg' | 'min' | 'max' | 'count';

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

/**
 * An additional named view over the same rows/columns — currently just an
 * alternate RENDER MODE (table vs kanban vs calendar), not an independent
 * filter/sort/hidden-column scope. Deliberately scoped-down v1: filter/sort/
 * aggregate/hidden stay the single table-wide fields they already are
 * (ColumnDefV2.filter, TableModelV2.sort/aggregate, .hidden), shared by every
 * view — a kanban or calendar view respects whatever filter is currently
 * active, it just can't have a DIFFERENT one from the table view. Per-view-
 * independent filter/sort is real, wanted follow-up work, deliberately
 * deferred: it would require every render-time reader of those fields
 * (isRowFiltered, applySortForDisplay, activeAggTypes, every `.hidden` check)
 * to resolve through "current view, else table-wide default" instead of
 * reading the table-wide field directly — a much larger, separate change
 * than standing up view *switching* itself.
 */
export interface ViewDefV2 {
	id: string;
	/** Absent = derive the display name from the current column header (see
	 *  viewDisplayName, renderViews.ts) — e.g. a kanban view stays labeled
	 *  after its group-by column even if that column is later renamed, with
	 *  no separate bookkeeping needed. Only set once the user explicitly
	 *  renames the view (rename-view), at which point it "detaches" from the
	 *  column and stays whatever they typed regardless of future renames. */
	name?: string;
	type: 'table' | 'kanban' | 'calendar';
	/** Present when type === 'kanban': which column's value groups rows into
	 *  lanes. Must be a choice-type column (see choiceRegistry.ts) — an "no
	 *  value" lane covers rows whose cell is empty or not one of the type's
	 *  defined options. */
	kanban?: { groupByColId: string };
	/** Present when type === 'calendar': which `type: date` column places a
	 *  row on the grid. A row whose cell is empty (or fails to parse as
	 *  YYYY-MM-DD — see renderDateCell.ts) has no day to sit on and is listed
	 *  in an "Unscheduled" tray below the grid instead. */
	calendar?: { dateColId: string };
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
	/** Active summary/aggregate rows, table-wide (not per-column) — array order is
	 *  render order, set by dragging a summary row's selector-strip grip. Each
	 *  active type computes a value for every column where that's meaningful
	 *  (numeric cells for sum/avg/min/max, any non-empty cell for count) and
	 *  leaves the rest blank — see `computeAggregateValue` in renderAggregate.ts. */
	aggregate?: AggType[];
	/** Additional views beyond the implicit default "Table" view (absent/no
	 *  activeViewId match = render the default table, exactly like a table with
	 *  no `views` field at all — this is what makes `views` purely additive:
	 *  a table written before this feature existed has no `views` field and
	 *  renders identically to today, no migration needed). */
	views?: ViewDefV2[];
	/** Which entry in `views` is currently shown; absent or unmatched = the
	 *  default Table view (today's plain rendering). */
	activeViewId?: string;
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
	/**
	 * When true, a single click on a cell enters edit mode *immediately* (no 200ms
	 * wait), and the style panel moves to Ctrl/Cmd+click (instead of double-click).
	 * Removes the per-cell 200ms single-vs-double-click disambiguation delay, which
	 * is the biggest contributor to sluggishness during rapid consecutive editing.
	 * When false (default), the classic behaviour is kept: single click enters edit
	 * after a 200ms delay, double click opens the style panel.
	 */
	singleClickEdit: boolean;
}
