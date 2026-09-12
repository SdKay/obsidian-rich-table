/**
 * computeCacheKey: a nested rich-table block (getSectionInfo returns null)
 * must get a cacheKey that's unique per call, not a bare sourcePath shared by
 * every nested table in the note — see blockCacheKey.ts for the bug that
 * shared key caused (a stale hover/edit/selection fact from one nested table
 * restored onto an unrelated one).
 */
import { describe, it, expect } from 'vitest';
import { computeCacheKey, NESTED_CACHE_KEY_MARKER } from '../src/blockCacheKey';

describe('computeCacheKey', () => {
	it('a top-level block (real section info) gets sourcePath:lineStart', () => {
		expect(computeCacheKey('note.md', { lineStart: 5 }, () => 'unused')).toBe('note.md:5');
	});

	it('a nested block (no section info) gets a key containing the nested marker', () => {
		const key = computeCacheKey('note.md', null, () => 'abc123');
		expect(key).toContain(NESTED_CACHE_KEY_MARKER);
		expect(key).toBe('note.md:nested-abc123');
	});

	it('two nested blocks in the SAME note never collide, even with the same sourcePath', () => {
		let n = 0;
		const nextSuffix = () => String(n++);
		const first = computeCacheKey('note.md', null, nextSuffix);
		const second = computeCacheKey('note.md', null, nextSuffix);
		expect(first).not.toBe(second);
	});

	it('a top-level key never contains the nested marker, even for a line number that could stringify oddly', () => {
		expect(computeCacheKey('note.md', { lineStart: 0 }, () => 'x')).not.toContain(NESTED_CACHE_KEY_MARKER);
	});
});
