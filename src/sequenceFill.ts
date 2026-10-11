export type FillKind = 'number' | 'circled' | 'roman' | 'date';

export interface FillSpec {
	kind: FillKind;
	/** Number, circled number and roman: the first value. Date: unused (see `startDate`). */
	start: number;
	/** Number step; for dates, the interval in `unit`s. May be negative. */
	step: number;
	/** First date as YYYY-MM-DD. */
	startDate: string;
	unit: 'day' | 'week' | 'month' | 'year';
}

export const DEFAULT_FILL: FillSpec = { kind: 'number', start: 1, step: 1, startDate: '', unit: 'day' };

/** Largest value with a single-character circled form (①…㊿). */
export const CIRCLED_MAX = 50;

const ROMAN: [number, string][] = [
	[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
	[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function toRoman(n: number): string | undefined {
	if (!Number.isInteger(n) || n < 1 || n > 3999) return undefined;
	let rest = n, out = '';
	for (const [value, glyph] of ROMAN) while (rest >= value) { out += glyph; rest -= value; }
	return out;
}

/** ①…⑳ are U+2460–2473, ㉑…㉟ U+3251–325F, ㊱…㊿ U+32B1–32BF. */
export function toCircled(n: number): string | undefined {
	if (!Number.isInteger(n) || n < 1 || n > CIRCLED_MAX) return undefined;
	if (n <= 20) return String.fromCodePoint(0x2460 + n - 1);
	if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
	return String.fromCodePoint(0x32b1 + n - 36);
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const formatDate = (d: Date) => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;

export function parseDate(text: string): Date | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
	if (!m) return undefined;
	const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
	const date = new Date(y, mo - 1, d);
	return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : undefined;
}

/** `index` steps after `start`. Months and years clamp to the month's last day
 *  (31 Jan + 1 month = 28/29 Feb) and always count from `start`, so the clamp
 *  never drifts later values. */
function addToDate(start: Date, unit: FillSpec['unit'], amount: number): Date {
	if (unit === 'day' || unit === 'week') {
		return new Date(start.getFullYear(), start.getMonth(), start.getDate() + amount * (unit === 'week' ? 7 : 1));
	}
	const months = unit === 'year' ? amount * 12 : amount;
	const target = new Date(start.getFullYear(), start.getMonth() + months, 1);
	const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	target.setDate(Math.min(start.getDate(), lastDay));
	return target;
}

export interface FillResult {
	values: string[];
	/** Values that could not be written in the chosen form and fell back to Arabic digits. */
	fellBack: number;
}

/** A problem with the inputs that should stop the fill before anything is written. */
export function validateFill(spec: FillSpec): 'startDate' | 'step' | 'start' | undefined {
	if (!Number.isFinite(spec.step) || (spec.kind === 'date' && !Number.isInteger(spec.step))) return 'step';
	if (spec.kind === 'date') return parseDate(spec.startDate) ? undefined : 'startDate';
	return Number.isFinite(spec.start) ? undefined : 'start';
}

/** The first `count` values of the sequence. Plain numbers never fall back; the
 *  circled and roman forms fall back to Arabic digits where no glyph exists. */
export function buildSequence(spec: FillSpec, count: number): FillResult {
	const values: string[] = [];
	let fellBack = 0;
	const first = spec.kind === 'date' ? parseDate(spec.startDate) : undefined;
	for (let i = 0; i < count; i++) {
		if (spec.kind === 'date') {
			values.push(first ? formatDate(addToDate(first, spec.unit, spec.step * i)) : '');
			continue;
		}
		const n = spec.start + spec.step * i;
		const formatted = spec.kind === 'circled' ? toCircled(n) : spec.kind === 'roman' ? toRoman(n) : String(n);
		if (formatted === undefined) fellBack++;
		values.push(formatted ?? String(n));
	}
	return { values, fellBack };
}

export interface FillRun {
	cells: { rowId: string; colId: string }[];
}

/**
 * The cells an auto-fill from a row/column selector writes, as independent runs: each
 * selected column fills top to bottom, each selected row left to right, every run
 * starting again from the first value. The header holds column names, so it is never
 * part of a run. `rowIds`/`colIds` are the table's ids in order; `lo..hi` is the
 * selection in display coordinates (rows: 0 = header, 1..N data; columns: 0-based).
 */
export function fillRuns(axis: 'row' | 'col', rowIds: string[], colIds: string[], lo: number, hi: number): FillRun[] {
	const runs: FillRun[] = [];
	if (axis === 'col') {
		for (let c = lo; c <= hi; c++) {
			const colId = colIds[c];
			if (!colId) continue;
			runs.push({ cells: rowIds.map(rowId => ({ rowId, colId })) });
		}
	} else {
		// Display row 0 is the header and has no entry in rowIds, so it drops out here.
		for (let r = lo; r <= hi; r++) {
			const rowId = rowIds[r - 1];
			if (!rowId) continue;
			runs.push({ cells: colIds.map(colId => ({ rowId, colId })) });
		}
	}
	return runs.filter(run => run.cells.length > 0);
}
