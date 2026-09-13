import { AbstractInputSuggest, App, TFolder } from 'obsidian';

/**
 * Vault-folder autocomplete for a plain `<input>` text box — same shape as
 * `wikilinkInputSuggest.ts`'s `WikilinkInputSuggest` (which does the same for
 * a contenteditable cell editor), but far simpler: no trigger character, no
 * insertion-at-caret logic — the whole input IS the folder path, so
 * `getValue`/`setValue` are `AbstractInputSuggest`'s own defaults and only
 * `getSuggestions`/`renderSuggestion`/`selectSuggestion` need overriding.
 * Used by `xlsxSaveModal.ts`'s folder-path field.
 */
export class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private readonly inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllFolders(true)
			.filter(f => f.path.toLowerCase().includes(q))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 20);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.isRoot() ? '/' : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.isRoot() ? '' : folder.path);
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		this.close();
	}
}
