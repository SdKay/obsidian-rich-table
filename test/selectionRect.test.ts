import { describe, it, expect } from 'vitest';
import { expandToMerges, type MergeBounds } from '../src/renderGridHelpers';

const m = (rowLo: number, rowHi: number, colLo: number, colHi: number): MergeBounds => ({ rowLo, rowHi, colLo, colHi });
const at = (row: number, col: number) => ({ row, col });

describe('expandToMerges', () => {
	it('a selection that touches no merge is the rectangle between its two corners, whichever way it was dragged', () => {
		expect(expandToMerges([], at(2, 3), at(4, 1))).toEqual({ r1: 2, r2: 4, c1: 1, c2: 3 });
		expect(expandToMerges([m(9, 10, 9, 10)], at(2, 3), at(2, 3))).toEqual({ r1: 2, r2: 2, c1: 3, c2: 3 });
	});

	it('touching part of a merge selects the whole merge', () => {
		expect(expandToMerges([m(2, 4, 2, 3)], at(3, 3), at(3, 3))).toEqual({ r1: 2, r2: 4, c1: 2, c2: 3 });
	});

	it('growing for one merge can reach the next, and the result no longer has a notch', () => {
		const merges = [m(2, 3, 2, 3), m(3, 5, 3, 6)];
		expect(expandToMerges(merges, at(2, 2), at(2, 2))).toEqual({ r1: 2, r2: 5, c1: 2, c2: 6 });
	});

	it('merges the selection does not touch are left out', () => {
		expect(expandToMerges([m(2, 3, 2, 3), m(8, 9, 8, 9)], at(2, 2), at(2, 2))).toEqual({ r1: 2, r2: 3, c1: 2, c2: 3 });
	});

	it('does not depend on the order the merges are listed in', () => {
		const a = [m(2, 3, 2, 3), m(3, 5, 3, 6), m(5, 7, 6, 8)];
		const want = expandToMerges(a, at(2, 2), at(2, 2));
		expect(expandToMerges([...a].reverse(), at(2, 2), at(2, 2))).toEqual(want);
		expect(want).toEqual({ r1: 2, r2: 7, c1: 2, c2: 8 });
	});
});
