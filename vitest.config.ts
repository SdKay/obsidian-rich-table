import { defineConfig } from 'vitest/config';
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
	},
	resolve: {
		alias: {
			// Mock Obsidian with js-yaml so tests can run outside Obsidian
			obsidian: new URL('./test/__mocks__/obsidian.ts', import.meta.url).pathname,
		},
	},
});
