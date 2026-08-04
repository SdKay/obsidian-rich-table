// Bundles the REAL source under test (real-bundle-entry.ts) into a
// browser-loadable script for e2e fixtures — run automatically by
// playwright.config.ts's globalSetup before every e2e run, so it's always
// fresh against whatever src/ currently contains (never committed, same
// treatment as main.js).
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
	entryPoints: [path.join(__dirname, 'real-bundle-entry.ts')],
	outfile: path.join(__dirname, 'real-bundle.generated.js'),
	bundle: true,
	format: 'iife',
	globalName: 'RichTableReal',
	platform: 'browser',
	target: 'chrome120',
	alias: {
		obsidian: path.join(__dirname, 'obsidian-shim.ts'),
	},
});
