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
}

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
}
