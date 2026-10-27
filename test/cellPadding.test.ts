import { describe, it, expect } from 'vitest';
import { cellPaddingOf, DEFAULT_CELL_PADDING_Y } from '../src/cellPadding';

describe('cellPaddingOf', () => {
	it('keeps a whole number inside the range', () => {
		expect(cellPaddingOf(0)).toBe(0);
		expect(cellPaddingOf(9)).toBe(9);
		expect(cellPaddingOf(16)).toBe(16);
	});

	it('pulls a value outside the range back to its edge', () => {
		expect(cellPaddingOf(-3)).toBe(0);
		expect(cellPaddingOf(40)).toBe(16);
	});

	it('rounds a fraction to the nearest whole px', () => {
		expect(cellPaddingOf(4.4)).toBe(4);
		expect(cellPaddingOf(4.6)).toBe(5);
	});

	it('falls back to the default for anything that is not a finite number', () => {
		for (const bad of [undefined, null, '8', NaN, Infinity, {}]) expect(cellPaddingOf(bad)).toBe(DEFAULT_CELL_PADDING_Y);
	});

	it('the default is 4', () => {
		expect(DEFAULT_CELL_PADDING_Y).toBe(4);
	});
});
