import { App, FileSystemAdapter, Modal, Notice, Platform, Setting, TFile, normalizePath } from 'obsidian';
import { t } from './i18n';
import { FolderInputSuggest } from './folderInputSuggest';

/**
 * Prompts for a destination, then hands the result to `onExport`. Two
 * completely separate sections, not two paths merged into one shared set of
 * fields — each is a self-contained way to finish the export, matching how
 * each one's OWN "confirm" action already works elsewhere in the OS/Obsidian:
 *
 *  - **Top: in the vault.** Folder (with vault-folder autocomplete,
 *    `FolderInputSuggest`) + file name + its own **Export** button. Always
 *    available, including mobile — the only section mobile ever sees.
 *  - **Bottom, desktop only: custom location.** One **Choose location…**
 *    button that opens the OS's own native save dialog
 *    (`require('electron').remote.dialog` — unsupported-by-Obsidian but
 *    confirmed-working, see `electron.d.ts`'s own doc comment) and exports
 *    IMMEDIATELY once the user confirms a path there — no second button to
 *    click in THIS modal, since the OS dialog's own "Save" already was that
 *    confirmation. A path that happens to fall inside the vault still routes
 *    through `vault.createBinary` (`tableBlock.ts`'s `exportToXlsx`
 *    resolves this from whether `onExport` receives `vaultPath` or
 *    `absolutePath`), same as if it had been typed into the top section.
 *
 * Deliberately NOT one shared folder/filename pair driving both paths (an
 * earlier version worked that way): browsing to a location and then having
 * to click a SEPARATE Export button afterward defeats the OS dialog's own
 * "Save" click, which the user already experiences as "and now it's saved."
 */
export class XlsxSaveModal extends Modal {
	private folder: string;
	private filename: string;

	constructor(
		app: App,
		defaultFolder: string,
		defaultFilename: string,
		private readonly onExport: (result: { vaultPath?: string; absolutePath?: string }) => void,
	) {
		super(app);
		this.folder = defaultFolder;
		this.filename = defaultFilename;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(t('exportXlsxModalTitle'));

		new Setting(contentEl).setName(t('exportXlsxInVault')).setHeading();

		new Setting(contentEl)
			.setName(t('exportXlsxFolder'))
			.addText(text => {
				text.setPlaceholder(t('exportXlsxFolderPlaceholder'))
					.setValue(this.folder)
					.onChange(v => { this.folder = v; });
				new FolderInputSuggest(this.app, text.inputEl);
			});

		new Setting(contentEl)
			.setName(t('exportXlsxFilename'))
			.addText(text => {
				text.setValue(this.filename)
					.onChange(v => { this.filename = v; });
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('exportXlsxSubmit'))
				.setCta()
				.onClick(() => this.submitVaultPath()));

		if (Platform.isDesktopApp) {
			new Setting(contentEl).setName(t('exportXlsxCustomLocation')).setHeading();
			new Setting(contentEl)
				.setDesc(t('exportXlsxCustomLocationDesc'))
				.addButton(btn => btn
					.setButtonText(t('exportXlsxBrowse'))
					.onClick(() => void this.browseAndExport()));
		}
	}

	/** Opens the native OS save dialog and, the instant the user confirms a
	 *  path there, closes this modal and calls `onExport` directly — see this
	 *  class's own doc comment for why there's no second "Export" click for
	 *  this section. Silently does nothing on cancel OR on failure (no
	 *  Notice for the latter): the top section's fields are still right
	 *  there if the user reopens, so a thrown/unavailable `remote` isn't an
	 *  error the user needs to see, just a shortcut that didn't pan out. */
	private async browseAndExport(): Promise<void> {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- same reasoning as tableBlock.ts's openXlsxFileExternally; a dynamic import() does not resolve in Obsidian's desktop runtime
			const { remote } = require('electron') as typeof import('electron');
			const adapter = this.app.vault.adapter;
			const vaultBasePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
			const defaultPath = vaultBasePath
				? `${vaultBasePath}/${this.folder ? this.folder + '/' : ''}${this.filename}`
				: this.filename;
			const result = await remote.dialog.showSaveDialog({
				defaultPath,
				filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
			});
			if (result.canceled || !result.filePath) return;

			const picked = result.filePath.replace(/\\/g, '/');
			const base = vaultBasePath?.replace(/\\/g, '/');
			this.close();
			if (base && (picked === base || picked.startsWith(base + '/'))) {
				// Falls inside the vault — route through vault.createBinary, same
				// as the top section, rather than a raw filesystem write.
				const rel = picked === base ? '' : picked.slice(base.length + 1);
				this.onExport({ vaultPath: normalizePath(rel) });
			} else {
				this.onExport({ absolutePath: picked });
			}
		} catch {
			// See this method's own doc comment — no Notice.
		}
	}

	private submitVaultPath(): void {
		const filename = this.filename.trim();
		if (!filename) { new Notice(t('exportXlsxFilenameRequired')); return; }
		const withExt = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
		const folder = this.folder.trim().replace(/^\/+|\/+$/g, '');
		const vaultPath = normalizePath(folder ? `${folder}/${withExt}` : withExt);
		this.close();
		this.onExport({ vaultPath });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Tiny yes/no confirmation, used for "this file already exists — overwrite?"
 *  — `obsidian.ConfirmationModal` needs Obsidian 1.13.0, newer than this
 *  plugin's own `minAppVersion` (1.8.7), so this plugin owns a minimal one
 *  instead of raising that floor for a single dialog. */
export class ConfirmOverwriteModal extends Modal {
	constructor(app: App, private readonly path: string, private readonly onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(t('exportXlsxOverwriteTitle'));
		contentEl.createEl('p', { text: `${this.path} ${t('exportXlsxOverwriteBody')}` });
		new Setting(contentEl)
			.addButton(btn => btn.setButtonText(t('exportXlsxCancel')).onClick(() => this.close()))
			.addButton(btn => btn.setButtonText(t('exportXlsxOverwrite'))
				// mod-warning: same plain CSS class setWarning()/setDestructive() apply
				// under the hood — used directly since setWarning() is deprecated and
				// setDestructive() needs Obsidian 1.13.0, newer than this plugin's own
				// minAppVersion (1.8.7).
				.setClass('mod-warning')
				.onClick(() => {
					this.close();
					this.onConfirm();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** True when `path` already exists as a real file in the vault — checked
 *  before `vault.createBinary`, which throws outright on an existing path
 *  rather than overwriting it. */
export async function vaultFileExists(app: App, path: string): Promise<boolean> {
	return app.vault.getAbstractFileByPath(path) instanceof TFile;
}
