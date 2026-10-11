// Re-export auto-generated theme metadata.
// generated.ts is written by esbuild.config.mjs at build time — do not edit it directly.
export type { ThemeMeta } from './generated';
export { BUILTIN_THEMES, BUILTIN_THEME_IDS } from './generated';

import { BUILTIN_THEME_IDS } from './generated';

/** The theme a new table should carry: the configured id if it still exists, else none. */
export const resolveDefaultTheme = (id: string): string | undefined =>
	BUILTIN_THEME_IDS.includes(id) ? id : undefined;
