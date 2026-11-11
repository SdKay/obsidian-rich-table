import { describe, it, expect } from 'vitest';
import { dragSelectsRange } from '../src/dragIntent';

describe('dragSelectsRange', () => {
	it('selects a range where the cells can be edited, with or without Alt', () => {
		expect(dragSelectsRange(true, false)).toBe(true);
		expect(dragSelectsRange(true, true)).toBe(true);
	});

	it('leaves the text to the browser where they cannot', () => {
		expect(dragSelectsRange(false, false)).toBe(false);
	});

	it('selects a range there when Alt is held', () => {
		expect(dragSelectsRange(false, true)).toBe(true);
	});
});
