/**
 * Minimal Obsidian mock for test environment.
 * Uses js-yaml to implement parseYaml / stringifyYaml.
 */
import * as yaml from 'js-yaml';

export function parseYaml(src: string): unknown {
	return yaml.load(src);
}

export function stringifyYaml(obj: unknown): string {
	return yaml.dump(obj, { lineWidth: -1, quotingType: '"', forceQuotes: false });
}

// Stub any other Obsidian exports referenced by the code under test
export class App {}
export class Component {}
export class MarkdownRenderChild {}
export class TFile {}
export class Modal {
	app: App;
	contentEl: HTMLElement = {} as HTMLElement;
	constructor(app: App) { this.app = app; }
	open() {}
	close() {}
}
export function setIcon() {}
export function MarkdownRenderer() {}
export function getLanguage(): string { return 'en'; }
