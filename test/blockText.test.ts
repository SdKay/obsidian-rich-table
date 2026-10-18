import { describe, it, expect } from 'vitest';
import { toggleListKind, isListKind, setHeading, headingLevel, insertLink, wrapBlock, insertCallout, insertRule } from '../src/blockText';

type E = { from: number; to: number; replacement: string } | null;
const run = (text: string, e: E) => (e ? text.slice(0, e.from) + e.replacement + text.slice(e.to) : text);

describe('list kinds', () => {
	const T = 'one\ntwo\nthree';
	it('makes every selected line a bullet, and a second pick takes it off', () => {
		const on = run(T, toggleListKind(T, 0, T.length, 'bullet'));
		expect(on).toBe('- one\n- two\n- three');
		expect(run(on, toggleListKind(on, 0, on.length, 'bullet'))).toBe(T);
	});
	it('numbers the lines in order', () => {
		expect(run(T, toggleListKind(T, 0, T.length, 'number'))).toBe('1. one\n2. two\n3. three');
	});
	it('makes tasks and quotes', () => {
		expect(run(T, toggleListKind(T, 0, T.length, 'task'))).toBe('- [ ] one\n- [ ] two\n- [ ] three');
		expect(run(T, toggleListKind(T, 0, T.length, 'quote'))).toBe('> one\n> two\n> three');
	});
	it('only touches the lines the selection reaches', () => {
		expect(run(T, toggleListKind(T, 5, 6, 'bullet'))).toBe('one\n- two\nthree');
	});
	it('switches a line of another kind instead of stacking prefixes', () => {
		const t = '- one\n2. two';
		expect(run(t, toggleListKind(t, 0, t.length, 'number'))).toBe('1. one\n2. two');
	});
	it('a task is not a bullet, and the other way round', () => {
		expect(isListKind('- [ ] a', 0, 7, 'bullet')).toBe(false);
		expect(isListKind('- [ ] a', 0, 7, 'task')).toBe(true);
		expect(isListKind('- a', 0, 3, 'bullet')).toBe(true);
	});
	it('leaves blank lines alone and does not number them', () => {
		const t = 'a\n\nb';
		expect(run(t, toggleListKind(t, 0, t.length, 'number'))).toBe('1. a\n\n2. b');
	});
	it('works on a caret with no selection (the line it is on)', () => {
		expect(run('a\nb', toggleListKind('a\nb', 3, 3, 'bullet'))).toBe('a\n- b');
	});
});

describe('an empty line', () => {
	it('gets the prefix, so an empty cell can start a list, task list, quote or heading', () => {
		expect(run('', toggleListKind('', 0, 0, 'bullet'))).toBe('- ');
		expect(run('', toggleListKind('', 0, 0, 'number'))).toBe('1. ');
		expect(run('', toggleListKind('', 0, 0, 'task'))).toBe('- [ ] ');
		expect(run('', toggleListKind('', 0, 0, 'quote'))).toBe('> ');
		expect(run('', setHeading('', 0, 0, 2))).toBe('## ');
	});
	it('puts the caret after the prefix when there is no selection', () => {
		expect(toggleListKind('', 0, 0, 'bullet')).toMatchObject({ selFrom: 2, selTo: 2 });
	});
	it('works on an empty line between others, and toggles back off', () => {
		const t = 'a\n\nb';
		const on = run(t, toggleListKind(t, 2, 2, 'bullet'));
		expect(on).toBe('a\n- \nb');
		expect(run(on, toggleListKind(on, 3, 3, 'bullet'))).toBe(t);
	});
	it('is still skipped inside a selection that has text', () => {
		const t = 'a\n\nb';
		expect(run(t, toggleListKind(t, 0, t.length, 'bullet'))).toBe('- a\n\n- b');
	});
});

describe('headings', () => {
	it('sets, replaces and clears a heading', () => {
		expect(run('title', setHeading('title', 0, 5, 2))).toBe('## title');
		expect(run('# title', setHeading('# title', 0, 7, 3))).toBe('### title');
		expect(run('## title', setHeading('## title', 0, 8, 0))).toBe('title');
	});
	it('the same level again is body text', () => {
		expect(run('## t', setHeading('## t', 0, 4, 2))).toBe('t');
	});
	it('reads a shared level, or null when they differ', () => {
		expect(headingLevel('## a\n## b', 0, 9)).toBe(2);
		expect(headingLevel('## a\nb', 0, 6)).toBeNull();
		expect(headingLevel('plain', 0, 5)).toBe(0);
	});
});

describe('line ranges', () => {
	it('an empty first line is its own line', () => {
		expect(run('\nb', toggleListKind('\nb', 0, 0, 'bullet'))).toBe('- \nb');
		expect(run('\nb', toggleListKind('\nb', 1, 2, 'bullet'))).toBe('\n- b');
	});
	it('a selection ending right after a line break does not reach the next line', () => {
		expect(run('a\nb', toggleListKind('a\nb', 0, 2, 'bullet'))).toBe('- a\nb');
	});
});

describe('links', () => {
	it('wraps the selection as a wikilink', () => {
		expect(run('see Note now', insertLink('see Note now', 4, 8, false))).toBe('see [[Note]] now');
	});
	it('wraps it as an external link and puts the caret in the parentheses', () => {
		const e = insertLink('see Note now', 4, 8, true)!;
		expect(run('see Note now', e)).toBe('see [Note]() now');
		expect(e.selFrom).toBe(4 + '[Note](' .length);
	});
	it('does nothing without a selection', () => {
		expect(insertLink('abc', 1, 1, false)).toBeNull();
	});
});

describe('insert blocks', () => {
	it('fences the selected lines as a code block', () => {
		expect(run('a\nb', wrapBlock('a\nb', 0, 3, '```', '```'))).toBe('```\na\nb\n```');
	});
	it('fences math with $$', () => {
		expect(run('x^2', wrapBlock('x^2', 0, 3, '$$', '$$'))).toBe('$$\nx^2\n$$');
	});
	it('turns lines into a callout', () => {
		expect(run('a\nb', insertCallout('a\nb', 0, 3))).toBe('> [!note]\n> a\n> b');
	});
	it('adds a rule after the selected line, with a blank line so the text does not become a heading', () => {
		expect(run('a\nb', insertRule('a\nb', 0, 1))).toBe('a\n\n---\nb');
	});
	it('adds a rule after the last line', () => {
		expect(run('a', insertRule('a', 0, 1))).toBe('a\n\n---');
	});
	it('needs no extra blank line after an empty line', () => {
		expect(run('a\n', insertRule('a\n', 2, 2))).toBe('a\n\n---');
	});
});
