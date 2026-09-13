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
	// Same as the plugin's own build: the insertable templates are imported as
	// text, and the write-back layer reaches them through tableBlock.ts.
	loader: { '.yaml': 'text' },
	// tableBlock.ts's exportToXlsx require()s 'fs/promises' behind a
	// Platform.isDesktop guard that's always false in this browser-only
	// bundle (obsidian-shim.ts's Platform stub), so the call is genuinely
	// unreachable here — but esbuild still refuses to BUNDLE a recognized
	// Node builtin for a browser target even when unreachable at runtime
	// (unlike 'electron', which esbuild doesn't recognize as a builtin at
	// all and just leaves as a literal unresolved require() call). Marking
	// it external leaves that same literal require('fs/promises') in the
	// output instead of erroring at build time — exactly the outcome we want,
	// since the guard means it's never actually called from a browser.
	external: ['fs/promises'],
});
