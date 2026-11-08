import { describe, it, expect } from 'vitest';
import { stripsToRebuild, sameRowGeometry, type StripAxis } from '../src/stripRebuildPlan';

const none = new Set<StripAxis>();
const sorted = (s: ReadonlySet<StripAxis>) => [...s].sort();
const same = () => false;
const moved = () => true;

describe('stripsToRebuild', () => {
	it('rebuilds both strips when they were never built or were marked stale outright', () => {
		expect(sorted(stripsToRebuild(none, null, { w: 500, h: 300 }, same))).toEqual(['col', 'row']);
	});

	it('rebuilds nothing when the table is the size it was and nothing was dragged, without reading the rows', () => {
		let asked = 0;
		const out = stripsToRebuild(none, { w: 500, h: 300 }, { w: 500.2, h: 300.3 }, () => { asked++; return true; });
		expect(sorted(out)).toEqual([]);
		expect(asked).toBe(0);
	});

	it('a column drag that moved no row rebuilds the column strip alone', () => {
		expect(sorted(stripsToRebuild(new Set<StripAxis>(['col']), { w: 500, h: 300 }, { w: 530, h: 300 }, same))).toEqual(['col']);
	});

	it('a column drag that moved a row (text wrapped or unwrapped) rebuilds the row strip as well', () => {
		expect(sorted(stripsToRebuild(new Set<StripAxis>(['col']), { w: 500, h: 300 }, { w: 470, h: 360 }, moved))).toEqual(['col', 'row']);
	});

	it('rows that moved while the table kept its height (one grew as another shrank) still rebuild the row strip', () => {
		expect(sorted(stripsToRebuild(new Set<StripAxis>(['col']), { w: 500, h: 300 }, { w: 470, h: 300 }, moved))).toEqual(['col', 'row']);
	});

	it('a column whose drag changed neither the table nor any row still rebuilds the column strip', () => {
		expect(sorted(stripsToRebuild(new Set<StripAxis>(['col']), { w: 500, h: 300 }, { w: 500, h: 300 }, same))).toEqual(['col']);
	});

	it('a row drag rebuilds the row strip without reading the rows', () => {
		let asked = 0;
		expect(sorted(stripsToRebuild(new Set<StripAxis>(['row']), { w: 500, h: 300 }, { w: 500, h: 340 }, () => { asked++; return true; }))).toEqual(['row']);
		expect(asked).toBe(0);
	});

	it('a table that changed size with nothing dragged (the pane resized) rebuilds the strip of each side that moved', () => {
		expect(sorted(stripsToRebuild(none, { w: 500, h: 300 }, { w: 620, h: 300 }, same))).toEqual(['col']);
		expect(sorted(stripsToRebuild(none, { w: 500, h: 300 }, { w: 620, h: 300 }, moved))).toEqual(['col', 'row']);
		expect(sorted(stripsToRebuild(none, { w: 500, h: 300 }, { w: 500, h: 410 }, moved))).toEqual(['row']);
	});

	it('does not change the set it is given', () => {
		const stale = new Set<StripAxis>(['col']);
		stripsToRebuild(stale, { w: 500, h: 300 }, { w: 470, h: 360 }, moved);
		expect(sorted(stale)).toEqual(['col']);
	});
});

describe('sameRowGeometry', () => {
	it('the same rows in the same places are the same', () => {
		expect(sameRowGeometry([0, 20, 20, 20, 40, 20], [0.2, 20.1, 20, 19.8, 40.3, 20])).toBe(true);
	});

	it('one row taller and the next one shorter is different even though the total is the same', () => {
		expect(sameRowGeometry([0, 20, 20, 20, 40, 20], [0, 30, 30, 10, 40, 20])).toBe(false);
	});

	it('a row that only moved down is different', () => {
		expect(sameRowGeometry([0, 20, 20, 20, 40, 20], [0, 20, 20, 20, 45, 20])).toBe(false);
	});

	it('a different number of rows is different', () => {
		expect(sameRowGeometry([0, 20], [0, 20, 20, 20])).toBe(false);
	});
});

describe('stripsToRebuild, columns that moved', () => {
	it('columns that moved while the table kept its width (an auto column grew as another shrank) rebuild the column strip', () => {
		expect(sorted(stripsToRebuild(none, { w: 500, h: 300 }, { w: 500, h: 340 }, same, moved))).toEqual(['col']);
	});
	it('does not read the columns when nothing was dragged and the table is the size it was', () => {
		let asked = 0;
		expect(sorted(stripsToRebuild(none, { w: 500, h: 300 }, { w: 500, h: 300 }, same, () => { asked++; return true; }))).toEqual([]);
		expect(asked).toBe(0);
	});
	it('does not read the columns when the table got wider, which rebuilds the column strip anyway', () => {
		let asked = 0;
		stripsToRebuild(none, { w: 500, h: 300 }, { w: 600, h: 300 }, same, () => { asked++; return true; });
		expect(asked).toBe(0);
	});
});
