import { describe, it, expect } from 'vitest';
// @ts-expect-error: a plain .mjs build helper
import { splitRules, keepRules, renderRules, pageVariables } from '../static-export-css-gen.mjs';

const CSS = `
/* a comment { with braces } */
.bt-a { color: red; }
.bt-a .bt-b, .bt-gone { margin: 0; }
.bt-gone { padding: 1px; }
.bt-c:hover > .bt-a { color: var(--text-normal, #333); }
.bt-d { width: var(--bt-own, 10px); background: var(--bg-page); }
mark.bt-hit.bt-hit { color: red; }
`;

describe('static export css', () => {
	const rules = splitRules(CSS);

	it('splits a stylesheet into its rules and drops comments', () => {
		expect(rules.map((r: { selector: string }) => r.selector)).toEqual(['.bt-a', '.bt-a .bt-b, .bt-gone', '.bt-gone', '.bt-c:hover > .bt-a', '.bt-d', 'mark.bt-hit.bt-hit']);
	});

	it('keeps a rule only for the selectors whose classes are all used', () => {
		const kept = keepRules(rules, ['bt-a', 'bt-b', 'bt-c', 'bt-d']);
		expect(kept.map((r: { selector: string }) => r.selector)).toEqual(['.bt-a', '.bt-a .bt-b', '.bt-c:hover > .bt-a', '.bt-d']);
	});

	it('drops a selector that names one class that is used and one that is not', () => {
		const kept = keepRules(splitRules('.bt-a .bt-gone { color: red; } .bt-a .bt-b { color: blue; }'), ['bt-a', 'bt-b']);
		expect(kept.map((r: { selector: string }) => r.selector)).toEqual(['.bt-a .bt-b']);
	});

	it('never keeps a selector that names no class at all', () => {
		const kept = keepRules(splitRules('* { margin: 0; } body, .bt-a { color: red; } div > span { x: y; }'), ['bt-a']);
		expect(kept.map((r: { selector: string }) => r.selector)).toEqual(['.bt-a']);
	});

	it('keeps a fallback once one is seen, whichever use comes first', () => {
		expect(pageVariables(splitRules('.bt-a { color: var(--page-c); } .bt-b { color: var(--page-c, #123); }'), [])).toEqual({ '--page-c': '#123' });
		expect(pageVariables(splitRules('.bt-a { color: var(--page-c, #123); } .bt-b { color: var(--page-c); }'), [])).toEqual({ '--page-c': '#123' });
		expect(pageVariables(splitRules('.bt-a { color: var(--page-c, #123); } .bt-b { color: var(--page-c, #456); }'), [])).toEqual({ '--page-c': '#123' });
	});

	it('does not split a selector at a comma inside :is() or an attribute selector', () => {
		const kept = keepRules(splitRules('.bt-a:is(.bt-b, .bt-gone), .bt-c[data-x="1,2"] { color: red; }'), ['bt-a', 'bt-b', 'bt-c']);
		expect(kept).toHaveLength(1);
		expect(kept[0].selector).toContain('.bt-c[data-x="1,2"]');
	});

	it('lists the variables the page must give, with the first fallback seen, and none the stylesheet or the code gives', () => {
		const kept = keepRules(rules, ['bt-a', 'bt-c', 'bt-d']);
		expect(pageVariables(kept, ['--bg-page'])).toEqual({ '--text-normal': '#333' });
		expect(pageVariables(kept, [])).toEqual({ '--bg-page': null, '--text-normal': '#333' });
	});

	it('renders rules back as CSS that splits into the same rules', () => {
		const kept = keepRules(rules, ['bt-a', 'bt-b']);
		expect(splitRules(renderRules(kept)).map((r: { selector: string }) => r.selector)).toEqual(kept.map((r: { selector: string }) => r.selector));
	});

	it('never asks the page for a variable in the plugin\'s own --bt- namespace', () => {
		const rules = splitRules('.bt-a { width: var(--bt-pad, 4px); color: var(--text-normal); }');
		expect(pageVariables(rules, [])).toEqual({ '--text-normal': null });
	});

	it('also asks for a variable that only appears as another one\'s fallback', () => {
		const rules = splitRules('.bt-a { color: var(--page-a, var(--page-b, var(--page-c, red))); }');
		expect(pageVariables(rules, [])).toEqual({ '--page-a': 'var(--page-b, var(--page-c, red))', '--page-b': 'var(--page-c, red)', '--page-c': 'red' });
	});

	it('treats a variable given by a rule as given', () => {
		const withOwn = splitRules('.bt-a { --bt-x: 1px; } .bt-b { width: var(--bt-x); height: var(--page-h, 2px); }');
		expect(pageVariables(withOwn, [])).toEqual({ '--page-h': '2px' });
	});
});
