import { describe, it, expect } from 'vitest';
import { buildBlankTable } from '../src/blankTable';
import { planMarkdownTableConversion } from '../src/convertMarkdownTable';
import { displayTheme, resolveDefaultTheme } from '../src/themes';
import { DEFAULT_SETTINGS } from '../src/settings';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';

const TABLE = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];

describe('default theme for new tables', () => {
	it('is grid out of the box', () => {
		expect(DEFAULT_SETTINGS.defaultTheme).toBe('grid');
		expect(resolveDefaultTheme(DEFAULT_SETTINGS.defaultTheme)).toBe('grid');
	});

	// loadSettings is Object.assign({}, DEFAULT_SETTINGS, saved): an install that
	// predates the setting has no saved value and must pick up grid, while one that
	// chose "Default" (an empty string) must keep it.
	it('an existing install with no saved value gets grid, and a saved empty choice is kept', () => {
		const upgraded = Object.assign({}, DEFAULT_SETTINGS, { singleClickEdit: true });
		expect(upgraded.defaultTheme).toBe('grid');
		const chose = Object.assign({}, DEFAULT_SETTINGS, { defaultTheme: '' });
		expect(chose.defaultTheme).toBe('');
	});

	it('maps "no theme" and ids that no longer exist to no theme', () => {
		expect(resolveDefaultTheme('')).toBeUndefined();
		expect(resolveDefaultTheme('deleted-theme')).toBeUndefined();
		expect(resolveDefaultTheme('academic')).toBe('academic');
	});

	it('a blank table carries the theme, and none when there is none', () => {
		expect(buildBlankTable(2, 2, 'grid').theme).toBe('grid');
		expect('theme' in buildBlankTable(2, 2)).toBe(false);
	});

	it('survives the round trip a real insert performs', () => {
		const written = serializeTable(buildBlankTable(2, 2, 'academic'));
		expect(written).toContain('theme: academic');
		expect(parseTable(written).theme).toBe('academic');
		expect(serializeTable(buildBlankTable(2, 2))).not.toContain('theme:');
	});

	it('a converted Markdown table carries the theme', () => {
		const withTheme = planMarkdownTableConversion(TABLE, 0, 'grid');
		expect(withTheme?.blockText).toContain('theme: grid');
		const without = planMarkdownTableConversion(TABLE, 0);
		expect(without?.blockText).not.toContain('theme:');
	});
});

describe('the theme a table is shown with', () => {
	it('is its own when that theme exists', () => {
		expect(displayTheme('academic', 'grid')).toBe('academic');
	});

	it('is none when the table has none: that was chosen, it is not a missing theme', () => {
		expect(displayTheme(undefined, 'grid')).toBeUndefined();
	});

	it('falls back to the theme new tables get when its own no longer exists', () => {
		expect(displayTheme('plain', 'grid')).toBe('grid');
		expect(displayTheme('plain', 'academic')).toBe('academic');
	});

	it('is none when the theme new tables get is missing too', () => {
		expect(displayTheme('plain', '')).toBeUndefined();
		expect(displayTheme('plain', 'also-gone')).toBeUndefined();
	});
});
