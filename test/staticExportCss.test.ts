import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_BASE_CSS, EXPORT_PAGE_VARIABLES } from '../src/staticExportCss.generated';
import { EXPORT_CLASSES } from '../src/staticExportClasses';
// @ts-expect-error: a plain .mjs build helper
import { splitRules } from '../static-export-css-gen.mjs';

/**
 * src/staticExportCss.generated.ts is cut from styles.css by `node esbuild.config.mjs generate` (run by every build).
 * These check what the cut must satisfy, in terms of styles.css itself, so that a stylesheet changed without
 * regenerating fails here rather than shipping an export that has lost its rules.
 */
type Rule = { selector: string; body: string };
const css = fs.readFileSync(path.resolve('styles.css'), 'utf8');
const source: Rule[] = splitRules(css);
const generated: Rule[] = splitRules(EXPORT_BASE_CSS);
const used = new Set(EXPORT_CLASSES);
const classesOf = (selector: string) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]!);
const selectorsOf = (rule: Rule) => rule.selector.split(/,\s*(?![^(\[]*[)\]])/).map(s => s.trim()).filter(Boolean);
const usable = (selector: string) => classesOf(selector).length > 0 && classesOf(selector).every(c => used.has(c));
const normalize = (body: string) => body.replace(/\s+/g, ' ').trim();

describe('the export stylesheet', () => {
	it('holds, for every rule of styles.css, exactly the selectors whose classes are all ones an export can contain', () => {
		const want = source.flatMap(r => selectorsOf(r).filter(usable).map(s => `${s} {${normalize(r.body)}}`)).sort();
		const have = generated.flatMap(r => selectorsOf(r).map(s => `${s} {${normalize(r.body)}}`)).sort();
		expect(have).toEqual(want);
	});

	it('is much smaller than the stylesheet it is cut from', () => {
		expect(EXPORT_BASE_CSS.length).toBeLessThan(css.length / 4);
	});

	it('asks the page only for variables outside the plugin\'s own namespace, and says what each falls back to', () => {
		const names = Object.keys(EXPORT_PAGE_VARIABLES);
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) expect(name.startsWith('--bt-'), name).toBe(false);
		expect(names).toContain('--text-normal');
		expect(EXPORT_PAGE_VARIABLES['--h4-size']).toBe('1.1em');
	});

	it('leaves no variable out that the cut rules read from the page', () => {
		const given = new Set(generated.flatMap(r => [...r.body.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]!)));
		const read = new Set(generated.flatMap(r => [...r.body.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]!)));
		const left = [...read].filter(v => !v.startsWith('--bt-') && !given.has(v) && !(v in EXPORT_PAGE_VARIABLES));
		// What is left are variables the plugin sets from code on the elements an export drops or keeps inline.
		expect(left.every(v => /^--(cc|of|ri|rs|sb|fp|cs|rh|rt|rx|ry|cl|cw|strip)-?/.test(v)), left.join(', ')).toBe(true);
	});
});
