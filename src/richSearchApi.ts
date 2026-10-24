import type { WorkspaceLeaf } from 'obsidian';

/**
 * Copied from the Rich Search provider contract (sections 2 and 4), in
 * obsidian-rich-search/docs/superpowers/specs/2026-10-21-provider-contract.md.
 * Do not change a type here on its own: change the contract, then update every copy in one pass.
 * `import type` is erased at build time, so modules that import these types stay Obsidian-free.
 */

export interface RichSearchProvider {
	apiVersion: 1;
	/** Lower-case, no dot. Compound extensions are allowed. e.g. ['drawio', 'pptx', 'vsdx'] */
	extensions: string[];
	/** Bump whenever extract() would return different output for the same bytes. Part of rich-search's cache key. */
	extractVersion: number;
	extract(file: { path: string; content: ArrayBuffer }): Promise<ExtractResult>;
	/**
	 * Optional. Whether this provider's own file view is really the one registered for `ext`
	 * (Obsidian refuses a second registration of an extension). Absent = unknown, treated as yes.
	 */
	viewRegistered?(ext: string): boolean;

	/** Optional. Fence languages (lower-case info strings) this provider renders inside Markdown notes, e.g. ['rich-table']. See section 9. */
	blockLanguages?: string[];
	/**
	 * Optional. What a reader sees in one such block. Same rules and the same result type as extract().
	 * rich-search finds the block and hands over its source; the provider never sees the note or its line numbers.
	 * An empty list is valid: the block stands for content searched elsewhere (a rich-view block that points at a file).
	 */
	extractBlock?(block: { path: string; language: string; source: string }): Promise<ExtractResult>;
	/**
	 * Optional. Show `anchor` inside the provider's rendered block, in the note already open in `leaf`.
	 * `fromLine` (0-based, the opening fence) identifies the block. Returns false when there is nothing to reveal.
	 */
	revealBlock?(leaf: WorkspaceLeaf, target: { fromLine: number; anchor: unknown }, query: MatchOptions): boolean | Promise<boolean>;
}

export type ExtractResult =
	| { ok: true; value: ExtractedLine[] }
	| { ok: false; error: string };

export interface ExtractedLine {
	/** The text a person reads. One logical unit per line (a cell, a shape label, a text box). */
	text: string;
	/** Display text, e.g. "Sheet1!B4", "Slide 3". Shown in the result row. */
	location?: string;
	/** Opaque to rich-search; handed back unchanged on open (section 5). Must be JSON-serialisable and small. */
	anchor?: unknown;
}

export interface RichSearchHostApi {
	apiVersion: 1;
	/** All matches of `opts` in one text unit, in order. The only implementation of the matching rules. */
	matchLine(text: string, opts: MatchOptions): Span[];
	/**
	 * The search that is currently on screen, or null when the search panel is closed or its query is empty.
	 * Optional: absent in a rich-search that predates it, which a view treats as "no live highlight".
	 */
	currentQuery?(): MatchOptions | null;
	/**
	 * Calls `listener` whenever `currentQuery()` would return something different. Returns a function that
	 * stops the calls; a view must call it when it closes. Optional, together with `currentQuery`.
	 */
	onQueryChange?(listener: (query: MatchOptions | null) => void): () => void;
}
export interface MatchOptions { query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }
export interface Span { start: number; end: number } // half-open, in UTF-16 code units of `text`
