import { describe, it, expect } from 'vitest';
import { registerSelectedCell, takeSelectedCell } from '../src/renderSelectionHandoff';

/**
 * The registry is module-level and shared across every table on the page, keyed
 * by cacheKey — so per-key isolation and take()'s consume-once behaviour are the
 * two properties that actually matter here. A leaked entry would resurrect a
 * selection on some unrelated later rebuild; a non-isolated one would move the
 * highlight onto the wrong table.
 */
describe('renderSelectionHandoff', () => {
	it('registers and takes back the same cell', () => {
		registerSelectedCell('table-A', { row: 2, col: 1 });
		expect(takeSelectedCell('table-A')).toEqual({ row: 2, col: 1 });
	});

	it('take() consumes — a second take() on the same key returns undefined', () => {
		registerSelectedCell('table-B', { row: 0, col: 0 });
		takeSelectedCell('table-B');
		expect(takeSelectedCell('table-B')).toBeUndefined();
	});

	it('is isolated per cacheKey', () => {
		registerSelectedCell('table-C', { row: 1, col: 1 });
		registerSelectedCell('table-D', { row: 3, col: 3 });
		expect(takeSelectedCell('table-C')).toEqual({ row: 1, col: 1 });
		expect(takeSelectedCell('table-D')).toEqual({ row: 3, col: 3 });
	});

	it('registering null clears any previously-registered cell', () => {
		registerSelectedCell('table-E', { row: 1, col: 0 });
		registerSelectedCell('table-E', null);
		expect(takeSelectedCell('table-E')).toBeUndefined();
	});

	it('a later registration replaces an earlier one for the same table', () => {
		registerSelectedCell('table-F', { row: 1, col: 0 });
		registerSelectedCell('table-F', { row: 2, col: 2 });
		expect(takeSelectedCell('table-F')).toEqual({ row: 2, col: 2 });
	});

	it('returns undefined when nothing was ever registered for that key', () => {
		expect(takeSelectedCell('table-never-registered')).toBeUndefined();
	});

	it('carries the header row (row 0), not just data rows', () => {
		registerSelectedCell('table-G', { row: 0, col: 1 });
		expect(takeSelectedCell('table-G')).toEqual({ row: 0, col: 1 });
	});
});
