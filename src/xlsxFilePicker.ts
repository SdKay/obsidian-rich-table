import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian';
import { t } from './i18n';

/**
 * Fuzzy file picker scoped to `.xlsx` files already in the vault — the entry
 * point for "back this table with an external .xlsx file" (see
 * TableModelV2.xlsxSource / src/xlsxSource.ts). Only vault files are offered,
 * not an OS-native "any file on disk" dialog: `xlsxSource.path` is resolved
 * the same way a wikilink target is (`metadataCache.getFirstLinkpathDest`,
 * see tableBlock.ts's render()), which only ever resolves to something
 * already inside the vault.
 */
class XlsxFilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private readonly onChoose: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(t('xlsxPickerPlaceholder'));
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter(f => f.extension === 'xlsx');
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

/** Opens the picker, or — if the vault has no `.xlsx` files at all — shows a
 *  Notice instead, rather than opening a modal with nothing to search. */
export function openXlsxFilePicker(app: App, onChoose: (file: TFile) => void): void {
	const hasAny = app.vault.getFiles().some(f => f.extension === 'xlsx');
	if (!hasAny) {
		new Notice(t('noXlsxFilesInVault'));
		return;
	}
	new XlsxFilePickerModal(app, onChoose).open();
}
