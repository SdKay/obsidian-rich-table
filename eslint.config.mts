import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'tmp',
		'test',
		'esbuild.config.mjs',
		'vitest.config.ts',
		'playwright.config.ts',
		'version-bump.mjs',
		'lockfile-normalize.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// tableBlock.ts's openXlsxFileExternally requires('electron')
				// synchronously (see its own doc comment for why not a dynamic
				// import) — the only Node-global usage in this codebase so far.
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts', 'playwright.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
);
