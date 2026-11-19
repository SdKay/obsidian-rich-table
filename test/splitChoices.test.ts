import { describe, it, expect } from 'vitest';
import { splitChoices, type ResolvedMerge } from '../src/renderGridHelpers';

const merge = (rows: number, cols: number): ResolvedMerge => ({
	anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_x', endColId: 'c_x',
	startRow: 1, endRow: rows, startCol: 0, endCol: cols - 1,
});

describe('splitChoices', () => {
	it('offers both on a plain cell', () => {
		expect(splitChoices(undefined)).toEqual({ rows: true, cols: true });
	});

	it('lets a vertical merge be split into columns, and into rows when it spans an even number of them', () => {
		expect(splitChoices(merge(2, 1))).toEqual({ rows: true, cols: true });
		expect(splitChoices(merge(4, 1))).toEqual({ rows: true, cols: true });
		expect(splitChoices(merge(3, 1))).toEqual({ rows: false, cols: true });
	});

	it('lets a horizontal merge be split into rows, and into columns when it spans an even number of them', () => {
		expect(splitChoices(merge(1, 2))).toEqual({ rows: true, cols: true });
		expect(splitChoices(merge(1, 4))).toEqual({ rows: true, cols: true });
		expect(splitChoices(merge(1, 3))).toEqual({ rows: true, cols: false });
	});

	it('offers neither on a merge across both axes', () => {
		expect(splitChoices(merge(2, 2))).toEqual({ rows: false, cols: false });
		expect(splitChoices(merge(3, 4))).toEqual({ rows: false, cols: false });
	});
});
