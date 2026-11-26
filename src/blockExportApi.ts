/**
 * What a plugin publishes so that another plugin can turn its fenced blocks into static HTML (an HTML exporter, a
 * publisher). The exporter finds a provider by the block's fence language, hands over the block's source, and gets a
 * piece of markup it can put in a page without understanding it. Nothing here is specific to Rich Table: any plugin
 * that draws a fenced block can publish the same shape.
 *
 * Published as a property of the plugin instance, read as
 * `app.plugins.plugins['<plugin id>'].blockExport`. A copy of these types belongs in each plugin that uses them;
 * change this file and every copy together. `import type` is erased at build time, so this file adds no dependency.
 */

export interface BlockExportProvider {
	/** Checked first. A reader that does not know this number must not use the provider. */
	apiVersion: 1;
	/** Lower-case info strings of the fences this provider renders, e.g. ['rich-table']. */
	languages: string[];
	/** Goes up whenever `export` would return different markup for the same input. A reader may key a cache on it. */
	exportVersion: number;
	/**
	 * Renders one block. Never throws: a block that cannot be shown comes back as `{ ok: false }`, and the reader
	 * decides what to put in its place.
	 */
	export(block: BlockExportRequest): Promise<BlockExportResult>;
}

export interface BlockExportRequest {
	/** The fence's info string, lower-case; one of `languages`. */
	language: string;
	/** What is between the fences, as written in the note (any indent the fence had included). */
	source: string;
	/** The note the block is in, for whatever resolves against it (links, images). */
	sourcePath: string;
	/**
	 * The width in px the markup will be shown in, when the reader knows it. It only decides where text wraps; a
	 * provider must not draw anything that depends on it being right, and must work without it.
	 */
	width?: number;
}

export type BlockExportResult =
	| { ok: true; value: BlockExportOutput }
	| { ok: false; error: string };

export interface BlockExportOutput {
	/** Markup for a page: no script, no `<style>`, nothing positioned from a measurement of the screen it was drawn on. */
	html: string;
	/**
	 * What the markup needs from a stylesheet, and from which one. The reader puts `css` in the page once however many
	 * blocks use it, so `cssId` names it: two outputs with the same `cssId` carry the same `css`.
	 */
	css: { id: string; text: string };
	/**
	 * The CSS custom properties the stylesheet reads from the page, such as `--text-normal`, with the fallback each one
	 * has when the page does not set it (null when it has none). The reader maps these to its own variables.
	 */
	variables: Record<string, string | null>;
}
