import { describe, it, expect } from 'vitest';
import { toggleFormat, hasFormat, clearFormat, type FormatKind } from '../src/formatText';

const apply = (text: string, from: number, to: number, e: { from: number; to: number; replacement: string } | null) =>
	e ? text.slice(0, e.from) + e.replacement + text.slice(e.to) : text;
const toggle = (text: string, from: number, to: number, kind: FormatKind) => apply(text, from, to, toggleFormat(text, from, to, kind));

describe('toggleFormat', () => {
	it('wraps the selection in the mark of each kind', () => {
		expect(toggle('hello world', 6, 11, 'bold')).toBe('hello **world**');
		expect(toggle('hello world', 6, 11, 'italic')).toBe('hello *world*');
		expect(toggle('hello world', 6, 11, 'strike')).toBe('hello ~~world~~');
		expect(toggle('hello world', 6, 11, 'code')).toBe('hello `world`');
		expect(toggle('hello world', 6, 11, 'math')).toBe('hello $world$');
		expect(toggle('hello world', 6, 11, 'comment')).toBe('hello %%world%%');
	});
	it('unwraps when the marks sit just outside the selection', () => {
		expect(toggle('hello **world**', 8, 13, 'bold')).toBe('hello world');
	});
	it('unwraps when the selection includes the marks', () => {
		expect(toggle('hello **world**', 6, 15, 'bold')).toBe('hello world');
	});
	it('does nothing for an empty selection', () => {
		expect(toggleFormat('abc', 1, 1, 'bold')).toBeNull();
	});
	it('keeps the body selected after the edit', () => {
		expect(toggleFormat('abc', 0, 3, 'bold')).toMatchObject({ selFrom: 2, selTo: 5 });
	});
});

describe('hasFormat', () => {
	it('is true inside or around the marks, false otherwise', () => {
		expect(hasFormat('x **a** y', 4, 5, 'bold')).toBe(true);
		expect(hasFormat('x **a** y', 2, 7, 'bold')).toBe(true);
		expect(hasFormat('x a y', 2, 3, 'bold')).toBe(false);
	});
	it('does not read **bold** as italic', () => {
		expect(hasFormat('x **a** y', 4, 5, 'italic')).toBe(false);
		expect(hasFormat('x *a* y', 3, 4, 'italic')).toBe(true);
	});
});

describe('formats nested in each other', () => {
	const T = '==🔴**aaa**==';
	it('finds bold whether the whole highlight or only the text is selected', () => {
		expect(hasFormat(T, 0, T.length, 'bold')).toBe(true);
		expect(hasFormat(T, 6, 9, 'bold')).toBe(true);
		expect(hasFormat(T, 4, 11, 'bold')).toBe(true);
	});
	it('does not find a mark that is not there', () => {
		expect(hasFormat(T, 0, T.length, 'italic')).toBe(false);
		expect(hasFormat(T, 0, T.length, 'strike')).toBe(false);
	});
	it('finds each of two stacked formats', () => {
		const S = '~~**aaa**~~';
		expect(hasFormat(S, 4, 7, 'bold')).toBe(true);
		expect(hasFormat(S, 4, 7, 'strike')).toBe(true);
		expect(hasFormat(S, 0, S.length, 'strike')).toBe(true);
		expect(hasFormat('*a*', 1, 2, 'italic')).toBe(true);
		expect(hasFormat('***a***', 3, 4, 'italic')).toBe(true);
	});
	it('reads *** as bold and italic together', () => {
		expect(hasFormat('***a***', 3, 4, 'bold')).toBe(true);
		expect(hasFormat('**a**', 2, 3, 'italic')).toBe(false);
	});
	it('unwraps the bold inside a highlight and leaves the highlight', () => {
		expect(toggle(T, 6, 9, 'bold')).toBe('==🔴aaa==');
		expect(toggle(T, 0, T.length, 'bold')).toBe('==🔴aaa==');
	});
});

describe('a selection inside a format, not touching its marks', () => {
	it('finds the format around part of its text', () => {
		expect(hasFormat('**hello world**', 8, 13, 'bold')).toBe(true);
		expect(hasFormat('~~a b c~~', 4, 5, 'strike')).toBe(true);
		expect(hasFormat('*==🔵3    32    aaa==*', 15, 18, 'italic')).toBe(true);
	});
	it('does not reach across two separate formats', () => {
		expect(hasFormat('**a** b **c**', 6, 7, 'bold')).toBe(false);
	});
	it('does not cross a line break', () => {
		expect(hasFormat('**a\nb**', 4, 5, 'bold')).toBe(false);
	});
	it('does not read the inside of ** as italic', () => {
		expect(hasFormat('**hello world**', 8, 13, 'italic')).toBe(false);
	});
	it('toggles it off from the inside', () => {
		expect(toggle('**hello world**', 8, 13, 'bold')).toBe('hello world');
	});
});

describe('clearFormat', () => {
	it('removes the marks around the selection', () => {
		expect(apply('x **a** y', 4, 5, clearFormat('x **a** y', 4, 5))).toBe('x a y');
		expect(apply('x ==🔴a== y', 6, 7, clearFormat('x ==🔴a== y', 6, 7))).toBe('x a y');
	});
	it('removes marks the selection carries inside it', () => {
		expect(apply('x **a** y', 2, 7, clearFormat('x **a** y', 2, 7))).toBe('x a y');
	});
	it('removes nested marks', () => {
		expect(apply('~~**a**~~', 4, 5, clearFormat('~~**a**~~', 4, 5))).toBe('a');
	});
	it('does nothing for plain text', () => {
		expect(clearFormat('abc', 0, 3)).toBeNull();
	});
});
