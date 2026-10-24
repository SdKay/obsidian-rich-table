import { extractXlsx, XLSX_EXTENSIONS, XLSX_EXTRACT_VERSION } from './xlsxExtract';
import { extractBlock, isBlockAnchor, BLOCK_EXTRACT_VERSION, BLOCK_LANGUAGES, type BlockAnchor } from './blockExtract';
import type { MatchOptions, RichSearchProvider } from './richSearchApi';
import type { WorkspaceLeaf } from 'obsidian';

export interface RichSearchProviderHost {
	/**
	 * Whether this plugin's own file view is the one registered for `.xlsx`. Asked each time, because
	 * the registration can be refused (another plugin owns the extension) or toggled in settings.
	 */
	viewRegistered: () => boolean;
	/** Shows a hit in the rendered block that opens on `fromLine` of the note already open in `leaf`. */
	revealInNote: (leaf: WorkspaceLeaf, fromLine: number, anchor: BlockAnchor, query: MatchOptions) => Promise<boolean>;
}

/**
 * The object rich-table publishes as `plugin.richSearch` so Rich Search can read the text of
 * workbooks. Kept free of the plugin class so it can be tested on its own.
 */
export function createRichSearchProvider(host: RichSearchProviderHost): RichSearchProvider {
	return {
		apiVersion: 1,
		extensions: XLSX_EXTENSIONS,
		// One number for both readers, so a change to either one drops Rich Search's cached results.
		extractVersion: XLSX_EXTRACT_VERSION * 1000 + BLOCK_EXTRACT_VERSION,
		extract: file => extractXlsx(file.content),
		viewRegistered: ext => ext === 'xlsx' && host.viewRegistered(),
		blockLanguages: BLOCK_LANGUAGES,
		extractBlock: block => Promise.resolve(block.language === 'rich-table'
			? extractBlock(block.source)
			: { ok: false, error: `Rich Table does not read "${block.language}" blocks` }),
		// An anchor Rich Search hands back may be stale or malformed (the note changed since the search): that is false, not an error.
		revealBlock: async (leaf, target, query) => {
			if (!Number.isInteger(target.fromLine) || !isBlockAnchor(target.anchor)) return false;
			try {
				return await host.revealInNote(leaf, target.fromLine, target.anchor, query);
			} catch {
				return false;
			}
		},
	};
}
