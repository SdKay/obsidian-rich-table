// Re-export auto-generated theme metadata.
// generated.ts is written by esbuild.config.mjs at build time — do not edit it directly.
export type { ThemeMeta } from './generated';
export { BUILTIN_THEMES, BUILTIN_THEME_IDS } from './generated';

import { BUILTIN_THEME_IDS } from './generated';

/** The theme a new table should carry: the configured id if it still exists, else none. */
export const resolveDefaultTheme = (id: string): string | undefined =>
	BUILTIN_THEME_IDS.includes(id) ? id : undefined;

/**
 * The theme a table is drawn with. Its own, when that theme exists; none, when it has none (that is a
 * choice). A theme that no longer exists falls back to the one new tables get, rather than to no theme:
 * the note still says what it was, and drawing it unstyled would read as broken.
 */
export const displayTheme = (tableTheme: string | undefined, defaultTheme: string): string | undefined => {
	if (tableTheme === undefined) return undefined;
	return BUILTIN_THEME_IDS.includes(tableTheme) ? tableTheme : resolveDefaultTheme(defaultTheme);
};
