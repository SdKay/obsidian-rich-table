import { defineConfig } from 'vitest/config';

export default defineConfig({
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
