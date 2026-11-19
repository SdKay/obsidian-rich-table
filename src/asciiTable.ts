/**
 * Reads a plain-text table drawn with rules, the kind a command line prints, into a grid of cell texts:
 *
 *     +------+-----+        ┌──────┬─────┐
 *     | name | age |        │ name │ age │
 *     +------+-----+        ├──────┼─────┤
 *     | ann  |  30 |        │ ann  │  30 │
 *     +------+-----+        └──────┴─────┘
 *
 * A table starts and ends with a rule, which is what tells it from a Markdown pipe table. The columns are cut where
 * the rule has its corners, measured in display columns, so a `|` inside a cell stays in the cell and a wide
 * character is not counted as one. Merged cells and tables without rules are not read.
 */

/** Rule characters: the ASCII corner and bar, and the box-drawing sets (light, heavy, double). */
const RULE_FILL = '-=─━═';
const CROSS = '+┌┬┐├┼┤└┴┘┏┳┓┣╋┫┗┻┛╔╦╗╠╬╣╚╩╝╒╤╕╞╪╡╘╧╛╓╥╖╟╫╢╙╨╜';
const BAR = '|│┃║';

/** Columns a character takes on screen: East Asian wide and full-width characters take two, combining marks none. */
function charWidth(code: number): number {
	if (code === 0) return 0;
	if ((code >= 0x300 && code <= 0x36f) || (code >= 0x200b && code <= 0x200f) || code === 0xfe0f) return 0;
	if (
		(code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
		|| (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
		|| (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)
	) return 2;
	return 1;
}

/** The display column each character of `line` starts at, with the width of the whole line at the end. */
function columnsOf(line: string): { chars: string[]; start: number[]; width: number } {
	const chars = Array.from(line);
	const start: number[] = [];
	let at = 0;
	for (const ch of chars) {
		start.push(at);
		at += charWidth(ch.codePointAt(0) ?? 0);
	}
	return { chars, start, width: at };
}

const isRule = (line: string): boolean => {
	const t = line.trim();
	if (t.length < 2) return false;
	const chars = Array.from(t);
	let crosses = 0;
	for (const ch of chars) {
		if (CROSS.includes(ch)) crosses++;
		else if (!RULE_FILL.includes(ch)) return false;
	}
	return crosses >= 2 && CROSS.includes(chars[0] ?? '') && CROSS.includes(chars.at(-1) ?? '');
};

const isRow = (line: string): boolean => {
	const chars = Array.from(line.trim());
	return chars.length >= 2 && BAR.includes(chars[0] ?? '') && BAR.includes(chars.at(-1) ?? '');
};

/** Display columns of the rule's corners, taking the line's own leading space into account. */
function cornerColumns(rule: string): number[] {
	const { chars, start } = columnsOf(rule);
	const first = chars.findIndex(c => c.trim() !== '');
	const cols: number[] = [];
	for (let i = first; i < chars.length; i++) {
		if (CROSS.includes(chars[i] ?? '')) cols.push(start[i] ?? 0);
	}
	return cols;
}

/** The text between two display columns of a row. A character that straddles a cut is left out of both sides. */
function slice(row: ReturnType<typeof columnsOf>, from: number, to: number): string {
	let out = '';
	for (let i = 0; i < row.chars.length; i++) {
		const s = row.start[i] ?? 0;
		const w = (row.start[i + 1] ?? row.width) - s;
		if (s >= from && s + w <= to) out += row.chars[i];
	}
	return out.trim();
}

export interface AsciiTable {
	/** Rows of cell texts; with a header the first row is the column names. */
	values: string[][];
	hasHeader: boolean;
}

const joinLines = (group: string[][]): string[] =>
	(group[0] ?? []).map((_, c) => group.map(line => line[c] ?? '').join('\n').replace(/^\n+|\n+$/g, ''));

/** The table made of exactly `lines`, or null when they are not one. */
export function parseAsciiTable(lines: string[]): AsciiTable | null {
	if (lines.length < 3 || !isRule(lines[0] ?? '') || !isRule(lines.at(-1) ?? '')) return null;
	const corners = cornerColumns(lines[0] ?? '');
	if (corners.length < 2) return null;

	const blocks: string[][][] = []; // the physical lines between two rules, each cut into cells
	const inner: { text: string; blocksBefore: number }[] = [];
	let current: string[][] | null = null;
	for (let i = 1; i < lines.length - 1; i++) {
		const line = lines[i] ?? '';
		if (isRule(line)) {
			if (current) { blocks.push(current); current = null; }
			inner.push({ text: line.trim(), blocksBefore: blocks.length });
			continue;
		}
		if (!isRow(line)) return null;
		const cols = columnsOf(line);
		const first = cols.chars.findIndex(c => c.trim() !== '');
		const last = cols.chars.findLastIndex(c => c.trim() !== '');
		if ((cols.start[first] ?? 0) !== (corners[0] ?? 0) || (cols.start[last] ?? 0) !== (corners.at(-1) ?? 0)) return null;
		const cells: string[] = [];
		for (let c = 0; c < corners.length - 1; c++) cells.push(slice(cols, (corners[c] ?? 0) + 1, corners[c + 1] ?? 0));
		(current ??= []).push(cells);
	}
	if (current) blocks.push(current);
	if (blocks.length === 0) return null;

	// A rule under the first row marks it as the header, whether it is the only rule inside the table or every row has
	// one. Only a table with nothing but its top and bottom rules has no header.
	const headerRule = inner[0]?.blocksBefore === 1 && blocks.length >= 2 ? 0 : -1;
	const ruledByRow = inner.length - (headerRule >= 0 ? 1 : 0) > 0;

	const values: string[][] = [];
	blocks.forEach((block, i) => {
		if ((headerRule >= 0 && i === 0) || ruledByRow) { values.push(joinLines(block)); return; }
		// No rule between the body's lines: each line is a row, unless its first cell is empty, which continues the line above.
		let group: string[][] = [];
		for (const line of block) {
			if (group.length > 0 && line[0] === '' && line.some(c => c !== '')) group.push(line);
			else {
				if (group.length > 0) values.push(joinLines(group));
				group = [line];
			}
		}
		if (group.length > 0) values.push(joinLines(group));
	});
	return { values, hasHeader: headerRule >= 0 };
}

/** The table the cursor is on, with the lines it takes, or null when the cursor is not on one. */
export function findAsciiTableAtCursor(
	lines: string[],
	cursorLine: number,
): { startLine: number; endLine: number; values: string[][]; hasHeader: boolean } | null {
	let inFence = false;
	for (let i = 0; i < cursorLine; i++) if (/^\s*(```|~~~)/.test(lines[i] ?? '')) inFence = !inFence;
	if (inFence) return null;

	const line = lines[cursorLine] ?? '';
	if (!isRule(line) && !isRow(line)) return null;
	let startLine = cursorLine;
	while (startLine > 0 && (isRule(lines[startLine - 1] ?? '') || isRow(lines[startLine - 1] ?? ''))) startLine--;
	let endLine = cursorLine;
	while (endLine < lines.length - 1 && (isRule(lines[endLine + 1] ?? '') || isRow(lines[endLine + 1] ?? ''))) endLine++;

	// Two tables with no line between them run together; the one the cursor is on is the span between rules that
	// start and end a table, so cut the run at the rule before the cursor and the one after it.
	const run = lines.slice(startLine, endLine + 1);
	const ends = run.map((l, i) => i).filter(i => isRule(run[i] ?? ''));
	const at = cursorLine - startLine;
	for (let a = 0; a < ends.length; a++) {
		for (let b = ends.length - 1; b > a; b--) {
			const from = ends[a] ?? 0, to = ends[b] ?? 0;
			if (from <= at && at <= to) {
				const t = parseAsciiTable(run.slice(from, to + 1));
				if (t) return { startLine: startLine + from, endLine: startLine + to, ...t };
			}
		}
	}
	return null;
}
