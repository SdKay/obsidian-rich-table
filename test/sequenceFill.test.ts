import { describe, it, expect } from 'vitest';
import { buildSequence, fillRuns, toCircled, toRoman, validateFill, DEFAULT_FILL, type FillSpec } from '../src/sequenceFill';

const spec = (over: Partial<FillSpec>): FillSpec => ({ ...DEFAULT_FILL, ...over });
const values = (over: Partial<FillSpec>, n: number) => buildSequence(spec(over), n).values;

describe('numbers', () => {
	it('counts up from the start by the step', () => {
		expect(values({ start: 1, step: 1 }, 4)).toEqual(['1', '2', '3', '4']);
		expect(values({ start: 10, step: 5 }, 3)).toEqual(['10', '15', '20']);
	});
	it('handles negative steps, negative starts and decimals', () => {
		expect(values({ start: 3, step: -1 }, 5)).toEqual(['3', '2', '1', '0', '-1']);
		expect(values({ start: -2, step: 2 }, 3)).toEqual(['-2', '0', '2']);
		expect(values({ start: 0, step: 0.5 }, 3)).toEqual(['0', '0.5', '1']);
	});
	it('a zero step repeats the start', () => {
		expect(values({ start: 7, step: 0 }, 3)).toEqual(['7', '7', '7']);
	});
	it('never reports a fallback', () => {
		expect(buildSequence(spec({ start: 1, step: 1000 }), 100).fellBack).toBe(0);
	});
});

describe('circled numbers', () => {
	it('spans the three Unicode blocks without gaps', () => {
		expect(toCircled(1)).toBe('①');
		expect(toCircled(20)).toBe('⑳');
		expect(toCircled(21)).toBe('㉑');
		expect(toCircled(35)).toBe('㉟');
		expect(toCircled(36)).toBe('㊱');
		expect(toCircled(50)).toBe('㊿');
	});
	it('has nothing outside 1-50', () => {
		expect(toCircled(0)).toBeUndefined();
		expect(toCircled(51)).toBeUndefined();
		expect(toCircled(-1)).toBeUndefined();
		expect(toCircled(1.5)).toBeUndefined();
	});
	it('falls back to digits past 50 and says how many', () => {
		const r = buildSequence(spec({ kind: 'circled', start: 49, step: 1 }), 5);
		expect(r.values).toEqual(['㊾', '㊿', '51', '52', '53']);
		expect(r.fellBack).toBe(3);
	});
	it('falls back for zero and negatives too', () => {
		const r = buildSequence(spec({ kind: 'circled', start: 2, step: -1 }), 4);
		expect(r.values).toEqual(['②', '①', '0', '-1']);
		expect(r.fellBack).toBe(2);
	});
});

describe('roman numerals', () => {
	it.each([[1, 'I'], [4, 'IV'], [9, 'IX'], [14, 'XIV'], [40, 'XL'], [90, 'XC'], [400, 'CD'], [1994, 'MCMXCIV'], [3999, 'MMMCMXCIX']])('%i -> %s', (n, r) => {
		expect(toRoman(n)).toBe(r);
	});
	it('has nothing outside 1-3999', () => {
		expect(toRoman(0)).toBeUndefined();
		expect(toRoman(4000)).toBeUndefined();
		expect(toRoman(2.5)).toBeUndefined();
	});
	it('a sequence falls back to digits where there is no numeral', () => {
		const r = buildSequence(spec({ kind: 'roman', start: 2, step: -1 }), 4);
		expect(r.values).toEqual(['II', 'I', '0', '-1']);
		expect(r.fellBack).toBe(2);
	});
});

describe('dates', () => {
	const d = (startDate: string, unit: FillSpec['unit'], step: number, n: number) =>
		values({ kind: 'date', startDate, unit, step }, n);

	it('days and weeks', () => {
		expect(d('2026-10-30', 'day', 1, 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
		expect(d('2026-10-01', 'week', 1, 3)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
		expect(d('2026-10-05', 'day', -2, 3)).toEqual(['2026-10-05', '2026-10-03', '2026-10-01']);
	});
	it('months clamp to the month end without drifting later values', () => {
		expect(d('2026-01-31', 'month', 1, 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
		expect(d('2028-01-31', 'month', 1, 2)).toEqual(['2028-01-31', '2028-02-29']);
	});
	it('years, including a leap day', () => {
		expect(d('2024-02-29', 'year', 1, 3)).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
		expect(d('2026-06-15', 'year', 2, 2)).toEqual(['2026-06-15', '2028-06-15']);
	});
	it('crosses year boundaries both ways', () => {
		expect(d('2026-12-15', 'month', 1, 3)).toEqual(['2026-12-15', '2027-01-15', '2027-02-15']);
		expect(d('2026-01-15', 'month', -1, 3)).toEqual(['2026-01-15', '2025-12-15', '2025-11-15']);
	});
});

describe('validateFill', () => {
	it('accepts the defaults for each kind', () => {
		expect(validateFill(spec({}))).toBeUndefined();
		expect(validateFill(spec({ kind: 'date', startDate: '2026-10-13' }))).toBeUndefined();
	});
	it('rejects a missing or impossible start date', () => {
		expect(validateFill(spec({ kind: 'date', startDate: '' }))).toBe('startDate');
		expect(validateFill(spec({ kind: 'date', startDate: '2026-02-30' }))).toBe('startDate');
		expect(validateFill(spec({ kind: 'date', startDate: '2026/10/13' }))).toBe('startDate');
	});
	it('rejects non-numbers and fractional date steps', () => {
		expect(validateFill(spec({ start: NaN }))).toBe('start');
		expect(validateFill(spec({ step: NaN }))).toBe('step');
		expect(validateFill(spec({ kind: 'date', startDate: '2026-10-13', step: 1.5 }))).toBe('step');
	});
});

describe('fillRuns', () => {
	const rows = ['r1', 'r2', 'r3'];
	const cols = ['ca', 'cb', 'cc'];
	const ids = (run: { cells: { rowId: string; colId: string }[] }) => run.cells.map(c => `${c.rowId}.${c.colId}`);

	it('a column fills every data row top to bottom', () => {
		const runs = fillRuns('col', rows, cols, 1, 1);
		expect(runs).toHaveLength(1);
		expect(ids(runs[0]!)).toEqual(['r1.cb', 'r2.cb', 'r3.cb']);
	});

	it('several columns are independent runs, each starting over', () => {
		const runs = fillRuns('col', rows, cols, 0, 1);
		expect(runs.map(ids)).toEqual([['r1.ca', 'r2.ca', 'r3.ca'], ['r1.cb', 'r2.cb', 'r3.cb']]);
	});

	it('a row fills every column left to right', () => {
		const runs = fillRuns('row', rows, cols, 2, 2);
		expect(runs.map(ids)).toEqual([['r2.ca', 'r2.cb', 'r2.cc']]);
	});

	it('several rows are independent runs', () => {
		const runs = fillRuns('row', rows, cols, 1, 2);
		expect(runs.map(ids)).toEqual([['r1.ca', 'r1.cb', 'r1.cc'], ['r2.ca', 'r2.cb', 'r2.cc']]);
	});

	it('the header row is never filled', () => {
		expect(fillRuns('row', rows, cols, 0, 0)).toEqual([]);
		expect(fillRuns('row', rows, cols, 0, 1).map(ids)).toEqual([['r1.ca', 'r1.cb', 'r1.cc']]);
	});

	it('an empty table yields nothing rather than an empty run', () => {
		expect(fillRuns('col', [], cols, 0, 2)).toEqual([]);
	});

	it('ignores indices past the table', () => {
		expect(fillRuns('col', rows, cols, 2, 5)).toHaveLength(1);
		expect(fillRuns('row', rows, cols, 3, 9).map(ids)).toEqual([['r3.ca', 'r3.cb', 'r3.cc']]);
	});
});
