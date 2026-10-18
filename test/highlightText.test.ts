import { describe, it, expect } from 'vitest';
import { toggleHighlight, highlightAt } from '../src/highlightText';

const apply = (text: string, from: number, to: number, color?: Parameters<typeof toggleHighlight>[3]) => {
	const e = toggleHighlight(text, from, to, color);
	return e && text.slice(0, e.from) + e.replacement + text.slice(e.to);
};

describe('toggleHighlight', () => {
	it('wraps the selection, with or without a color', () => {
		expect(apply('hello world', 6, 11)).toBe('hello ==world==');
		expect(apply('hello world', 0, 5, 'red')).toBe('==🔴hello== world');
	});

	it('ignores an empty selection', () => {
		expect(toggleHighlight('abc', 1, 1)).toBeNull();
	});

	it('toggles off when the selection is the whole highlight', () => {
		expect(apply('a ==b== c', 2, 7)).toBe('a b c');
		expect(apply('a ==🟢b== c', 2, 9, 'green')).toBe('a b c');
	});

	it('toggles off when the selection is exactly the highlighted body', () => {
		expect(apply('a ==b== c', 4, 5)).toBe('a b c');
		expect(apply('==🔵text==', 4, 8, 'blue')).toBe('text');
	});

	it('recolors instead of nesting when the color differs', () => {
		expect(apply('==x==', 0, 5, 'red')).toBe('==🔴x==');
		expect(apply('==🔴x==', 4, 5, 'blue')).toBe('==🔵x==');
		expect(apply('==🔴x==', 4, 5)).toBe('==x==');
	});

	it('returns the selection that covers the new body', () => {
		const e = toggleHighlight('say hi', 4, 6, 'yellow')!;
		const next = 'say ==🟡hi==';
		expect(next.slice(e.selFrom, e.selTo)).toBe('hi');
	});
});

describe('highlightAt', () => {
	it('reads the color whether the selection is the body or the whole highlight', () => {
		expect(highlightAt('==🔴hi==', 4, 6)).toBe('red');
		expect(highlightAt('==🔴hi==', 0, 8)).toBe('red');
		expect(highlightAt('==hi==', 2, 4)).toBe('');
		expect(highlightAt('==hi==', 0, 6)).toBe('');
	});
	it('reads the square dots as the same colors', () => {
		expect(highlightAt('==🟦hi==', 4, 6)).toBe('blue');
	});
	it('finds the highlight around part of its text', () => {
		expect(highlightAt('==🔵3 32 aaa==', 9, 12)).toBe('blue');
		expect(highlightAt('==hello world==', 8, 13)).toBe('');
	});
	it('is null outside a highlight or with no selection', () => {
		expect(highlightAt('plain', 0, 5)).toBeNull();
		expect(highlightAt('==🔴hi==', 4, 4)).toBeNull();
	});
});
