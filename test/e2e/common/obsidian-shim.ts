// Minimal `obsidian` module shim for bundling real, pure-logic source files
// (src/parser.ts) for browser use in Playwright fixtures — mirrors
// test/__mocks__/obsidian.ts's vitest alias, but only needs parseYaml since
// the bundle entry (real-bundle-entry.ts) never touches App/Component/Menu/
// MarkdownRenderer.
import * as yaml from 'js-yaml';

export function parseYaml(src: string): unknown {
	return yaml.load(src);
}
