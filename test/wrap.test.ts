import { describe, it, expect } from 'vitest';
import { cellSizing, columnWraps, isFlexColumn } from '../src/wrap';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';

describe('columnWraps', () => {
	it('wraps unless something says not to', () => {
		expect(columnWraps({}, {})).toBe(true);
	});
	it('takes the column, then the table', () => {
		expect(columnWraps({}, { wrap: false })).toBe(false);
		expect(columnWraps({ wrap: true }, { wrap: false })).toBe(true);
		expect(columnWraps({ wrap: false }, { wrap: true })).toBe(false);
	});
	it('only an auto-width column that wraps is flexible', () => {
		expect(isFlexColumn({}, {})).toBe(true);
		expect(isFlexColumn({ width: 100 }, {})).toBe(false);
		expect(isFlexColumn({ wrap: false }, {})).toBe(false);
		expect(isFlexColumn({}, { wrap: false })).toBe(false);
		expect(isFlexColumn({ hidden: true }, {})).toBe(false);
	});
});

describe('wrap in the block', () => {
	const block = (extra: string, colExtra: string) => `---\nversion: 2\n${extra}columns:\n  - { id: c_a, name: A${colExtra} }\nrows: []\n---\n`;
	it('is read from the table and from a column, and written back', () => {
		const m = parseTable(block('wrap: false\n', ', wrap: true')) as unknown as import('../src/model').TableModelV2;
		expect(m.wrap).toBe(false);
		expect(m.columns[0]?.wrap).toBe(true);
		const out = serializeTable(m);
		expect(out).toContain('wrap: false');
		expect(out).toContain('wrap: true');
	});
	it('leaves a block without it as it was', () => {
		const m = parseTable(block('', '')) as unknown as import('../src/model').TableModelV2;
		expect(m.wrap).toBeUndefined();
		expect(serializeTable(m)).not.toContain('wrap');
	});
	it('ignores a value that is not true or false', () => {
		const m = parseTable(block('wrap: yes please\n', ', wrap: 1')) as unknown as import('../src/model').TableModelV2;
		expect(m.wrap).toBeUndefined();
		expect(m.columns[0]?.wrap).toBeUndefined();
	});
});

describe('cellSizing', () => {
	const cols = (...ws: (number | undefined)[]) => ws.map((width, i) => ({ id: `c${i}`, name: `C${i}`, ...(width ? { width } : {}) }));
	it('pins a cell to its column width, floored at the minimum', () => {
		expect(cellSizing({ columns: cols(100) }, 0)).toEqual({ width: 100, nowrap: false });
		expect(cellSizing({ columns: cols(10) }, 0)).toEqual({ width: 40, nowrap: false });
	});
	it('leaves an auto column to the browser', () => {
		expect(cellSizing({ columns: cols(undefined) }, 0).width).toBeNull();
	});
	it('pins a merge over fixed columns to their sum, skipping hidden ones', () => {
		const columns = [...cols(100, 60, 50)];
		columns[1] = { ...columns[1]!, hidden: true } as typeof columns[number];
		expect(cellSizing({ columns }, 0, 2).width).toBe(150);
	});
	it('leaves a merge that reaches an auto column to the browser', () => {
		expect(cellSizing({ columns: cols(100, undefined) }, 0, 1).width).toBeNull();
	});
	it('keeps to one line when its first column does not wrap', () => {
		expect(cellSizing({ columns: [{ id: 'a', name: 'A', wrap: false }] }, 0).nowrap).toBe(true);
		expect(cellSizing({ columns: cols(undefined), wrap: false }, 0).nowrap).toBe(true);
	});
});
