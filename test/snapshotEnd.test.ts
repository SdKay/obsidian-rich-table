import { describe, it, expect } from 'vitest';
import { contentEndRow } from '../src/snapshotEnd';

type Px = [number, number, number, number];
const WHITE: Px = [255, 255, 255, 255];
const NONE: Px = [0, 0, 0, 0];
const BLACK: Px = [20, 20, 20, 255];
const MARK: Px = [255, 0, 255, 255];
const col = (rows: Px[]) => rows.flat();

describe('contentEndRow', () => {
	it('is the first marker row, with empty canvas below it', () => {
		expect(contentEndRow(col([BLACK, WHITE, WHITE, MARK, MARK, MARK, NONE, NONE]))).toBe(3);
	});
	it('ignores a marker colour used inside the table', () => {
		expect(contentEndRow(col([MARK, WHITE, BLACK, MARK, MARK, NONE]))).toBe(3);
	});
	it('leaves out a row the marker covers only in part', () => {
		expect(contentEndRow(col([BLACK, [255, 140, 255, 255], MARK, MARK, NONE]))).toBe(1);
	});
	it('keeps a table row that is merely coloured', () => {
		expect(contentEndRow(col([BLACK, [255, 224, 224, 255], MARK, MARK, NONE]))).toBe(2);
	});
	it('is null when there is no marker', () => {
		expect(contentEndRow(col([BLACK, WHITE, NONE]))).toBeNull();
		expect(contentEndRow([])).toBeNull();
	});
});
