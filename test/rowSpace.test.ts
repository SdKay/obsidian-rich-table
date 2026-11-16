import { describe, it, expect } from 'vitest';
import { rowSpace } from '../src/rowSpace';

const rows = [{ id: 'r_a' }, { id: 'r_b' }, { id: 'r_c' }] as never;
const withHeader = rowSpace({ rows });
const without = rowSpace({ rows, header: false });

describe('rowSpace with a header', () => {
	it('starts at row 0, which is the header', () => {
		expect(withHeader.firstRow).toBe(0);
		expect(withHeader.hasHeader).toBe(true);
		expect(withHeader.isHeaderRow(0)).toBe(true);
		expect(withHeader.isHeaderRow(1)).toBe(false);
	});
	it('holds rows 0 to the last data row and nothing outside them', () => {
		expect(withHeader.lastRow).toBe(3);
		expect([-1, 0, 3].map(r => withHeader.contains(r))).toEqual([false, true, true]);
		expect(withHeader.contains(4)).toBe(false);
		expect(withHeader.contains(1.5)).toBe(false);
	});
	it('names row 0 `header` and the others by their id', () => {
		expect([0, 1, 3].map(r => withHeader.idAt(r))).toEqual(['header', 'r_a', 'r_c']);
		expect(withHeader.idAt(4)).toBe('');
		expect(withHeader.idAt(-1)).toBe('');
	});
	it('finds a row from its id', () => {
		expect(['header', 'r_a', 'r_c', 'r_zz'].map(i => withHeader.rowOf(i))).toEqual([0, 1, 3, -1]);
	});
});

describe('rowSpace without a header', () => {
	it('starts at row 1 and has no header row', () => {
		expect(without.firstRow).toBe(1);
		expect(without.hasHeader).toBe(false);
		expect(without.isHeaderRow(0)).toBe(false);
	});
	it('does not contain row 0', () => {
		expect(without.contains(0)).toBe(false);
		expect(without.contains(1)).toBe(true);
		expect(without.contains(3)).toBe(true);
	});
	it('has no id for row 0 and does not find the `header` id', () => {
		expect(without.idAt(0)).toBe('');
		expect(without.rowOf('header')).toBe(-1);
		expect(without.rowOf('r_b')).toBe(2);
	});
});

describe('rowSpace of a table with no data rows', () => {
	it('keeps the header and has no other row', () => {
		const s = rowSpace({ rows: [] });
		expect([s.firstRow, s.lastRow, s.contains(0), s.contains(1)]).toEqual([0, 0, true, false]);
	});
	it('has no row at all without a header', () => {
		const s = rowSpace({ rows: [], header: false });
		expect([s.firstRow, s.lastRow, s.contains(0), s.contains(1)]).toEqual([1, 0, false, false]);
	});
});
