import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';

/**
 * Rich Search asks for text through modules that must run without Obsidian (and may one day run outside it).
 * Bundling them with `obsidian` marked external shows any import of it, however deep.
 */
async function importsObsidian(entry: string): Promise<boolean> {
	const result = await build({
		entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
		external: ['obsidian'], logLevel: 'silent', loader: { '.yaml': 'text' },
	});
	return /from\s*["']obsidian["']|require\(["']obsidian["']\)/.test(result.outputFiles[0]?.text ?? '');
}

describe('the text readers do not depend on Obsidian', () => {
	it('blockExtract.ts', async () => {
		expect(await importsObsidian('src/blockExtract.ts')).toBe(false);
	});

	it('xlsxExtract.ts', async () => {
		expect(await importsObsidian('src/xlsxExtract.ts')).toBe(false);
	});

	it('the check itself sees an import of obsidian when there is one', async () => {
		expect(await importsObsidian('src/xlsxFileViewer.ts')).toBe(true);
	});
});
