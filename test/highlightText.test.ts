import { describe, it, expect } from 'vitest';
import { toggleHighlight } from '../src/highlightText';

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
