/**
 * applyThemeClass: swaps a root element's bt-theme-* class without touching any
 * other class. Regression test for a bug where tableBlock.ts's set-theme
 * instant-apply did a blanket `el.className = 'bt-render-root bt-theme-x'`
 * overwrite — silently wiping unrelated state classes (bt-has-strips,
 * bt-collapsed, ...) any time a theme was switched. bt-has-strips in
 * particular gates `position: absolute` for the edge-add/selector strips
 * (styles.css), so losing it dropped those strips into normal document flow —
 * visible as stray "+" buttons in blank space right after switching theme
 * while hovering. This test uses a plain fake object (no jsdom) since the
 * function only needs classList/addClass/removeClass, not a real DOM.
 */
import { describe, it, expect } from 'vitest';
import { applyThemeClass, type ThemeableEl } from '../src/renderThemeClass';

function fakeEl(initialClasses: string[]): ThemeableEl {
	let classes = [...initialClasses];
	return {
		get classList() { return classes; },
		addClass: (c: string) => { if (!classes.includes(c)) classes.push(c); },
		removeClass: (c: string) => { classes = classes.filter(x => x !== c); },
	};
}

describe('applyThemeClass', () => {
	it('adds the theme class without disturbing unrelated classes', () => {
		const el = fakeEl(['bt-render-root', 'bt-has-strips']);
		applyThemeClass(el, 'academic');
		const classes = el.classList as string[];
		expect(classes).toContain('bt-render-root');
		expect(classes).toContain('bt-has-strips');
		expect(classes).toContain('bt-theme-academic');
	});

	it('replaces an existing theme class instead of stacking a second one', () => {
		const el = fakeEl(['bt-render-root', 'bt-has-strips', 'bt-theme-academic']);
		applyThemeClass(el, 'plain');
		const classes = el.classList as string[];
		expect(classes).not.toContain('bt-theme-academic');
		expect(classes).toContain('bt-theme-plain');
		expect(classes).toContain('bt-has-strips'); // survives the swap
	});

	it('clearing the theme (null) removes the theme class but keeps everything else', () => {
		const el = fakeEl(['bt-render-root', 'bt-has-strips', 'bt-collapsed', 'bt-theme-academic']);
		applyThemeClass(el, null);
		const classes = el.classList as string[];
		expect(classes).not.toContain('bt-theme-academic');
		expect(classes).toContain('bt-has-strips');
		expect(classes).toContain('bt-collapsed');
		expect(classes).toContain('bt-render-root');
	});
});
