export interface YamlAdapter {
	parse(source: string): unknown;
	stringify(value: unknown): string;
}

let adapter: YamlAdapter | null = null;

/** The plugin installs Obsidian's own YAML; a standalone use installs another. */
export function setYamlAdapter(next: YamlAdapter): void {
	adapter = next;
}

function current(): YamlAdapter {
	if (!adapter) throw new Error('No YAML adapter installed: call setYamlAdapter() before parsing or serializing');
	return adapter;
}

export const parseYaml = (source: string): unknown => current().parse(source);
export const stringifyYaml = (value: unknown): string => current().stringify(value);
