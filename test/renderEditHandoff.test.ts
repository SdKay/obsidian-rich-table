/**
 * renderEditHandoff: the cross-rebuild "live edit" registry that lets a table
 * resume editing a cell after a write-back-triggered full rebuild, instead of
 * silently losing whatever draft text was mid-edit on some OTHER cell. See
 * the module's own header comment for why this can't just be a DOM reference
 * handed between instances.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerLiveEdit, clearLiveEdit, takeLiveEdit } from '../src/renderEditHandoff';

describe('renderEditHandoff', () => {
	it('registers and resolves a live edit for the exact (cacheKey, row, col)', () => {
		registerLiveEdit('k1', 2, 3, () => 'draft text');
		expect(takeLiveEdit('k1', 2, 3)).toMatchObject({ row: 2, col: 3 });
	});

	it('reads the draft text lazily via the getter, not a snapshot taken at register time', () => {
		let current = 'first';
		registerLiveEdit('k1', 0, 0, () => current);
		current = 'second'; // mutated after registration, before the resume actually reads it
		const entry = takeLiveEdit('k1', 0, 0);
		expect(entry?.getDraftText()).toBe('second');
	});

	it('take is consuming — a second take for the same key returns nothing', () => {
		registerLiveEdit('k1', 1, 1, () => 'x');
		expect(takeLiveEdit('k1', 1, 1)).toBeDefined();
		expect(takeLiveEdit('k1', 1, 1)).toBeUndefined();
	});

	it('does not resolve for a different row/col than what was registered', () => {
		registerLiveEdit('k1', 1, 1, () => 'x');
		expect(takeLiveEdit('k1', 1, 2)).toBeUndefined();
		expect(takeLiveEdit('k1', 2, 1)).toBeUndefined();
		// entry is still there for the correct coordinates (mismatched take must not consume it)
		expect(takeLiveEdit('k1', 1, 1)).toBeDefined();
	});

	it('does not resolve for a different cacheKey (different table)', () => {
		registerLiveEdit('table-a', 0, 0, () => 'x');
		expect(takeLiveEdit('table-b', 0, 0)).toBeUndefined();
		expect(takeLiveEdit('table-a', 0, 0)).toBeDefined();
	});

	it('clearLiveEdit removes only when row/col match — a deliberate commit does not leak into a later resume', () => {
		registerLiveEdit('k1', 5, 5, () => 'x');
		clearLiveEdit('k1', 9, 9); // different cell — must not clear the real entry
		expect(takeLiveEdit('k1', 5, 5)).toBeDefined();

		registerLiveEdit('k1', 5, 5, () => 'x');
		clearLiveEdit('k1', 5, 5);
		expect(takeLiveEdit('k1', 5, 5)).toBeUndefined();
	});

	it('a new registration for the same cacheKey replaces any previous one', () => {
		registerLiveEdit('k1', 1, 1, () => 'first');
		registerLiveEdit('k1', 2, 2, () => 'second');
		expect(takeLiveEdit('k1', 1, 1)).toBeUndefined(); // overwritten, not stacked
		expect(takeLiveEdit('k1', 2, 2)).toBeDefined();
	});

	it('ignores an entry older than the staleness guard', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		registerLiveEdit('k1', 1, 1, () => 'x');
		vi.setSystemTime(6000); // past MAX_AGE_MS
		expect(takeLiveEdit('k1', 1, 1)).toBeUndefined();
		vi.useRealTimers();
	});
});
