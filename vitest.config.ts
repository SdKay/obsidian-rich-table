import { defineConfig, configDefaults } from 'vitest/config';
import fs from 'node:fs';

export default defineConfig({
	plugins: [
		// Mirrors esbuild.config.mjs's `loader: { '.yaml': 'text' }` — Vite has no
		// built-in text loader for arbitrary extensions, so template YAML files
		// (imported as raw strings by src/templates/generated.ts) need this to
		// resolve under vitest at all; without it Vite tries to parse them as JS.
		{
			name: 'yaml-as-text',
			load(id) {
				if (!id.endsWith('.yaml')) return undefined;
				return `export default ${JSON.stringify(fs.readFileSync(id, 'utf8'))};`;
			},
		},
	],
	test: {
		globals: true,
		environment: 'node',
		// test/e2e/*.spec.ts is a separate Playwright suite (playwright.config.ts,
		// run via `npm run test:e2e`), not a vitest one — vitest's default
		// include glob matches *.spec.ts too, and running Playwright's test()
		// under vitest's runner breaks outright (different, incompatible
		// test-framework globals).
		exclude: [...configDefaults.exclude, 'test/e2e/**'],
	},
	resolve: {
		alias: {
			// Mock Obsidian with js-yaml so tests can run outside Obsidian
			obsidian: new URL('./test/__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
});
