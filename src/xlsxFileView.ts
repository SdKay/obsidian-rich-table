import { FileView, type TFile, type WorkspaceLeaf } from 'obsidian';
import type BetterTablePlugin from './main';
import { XlsxFileViewer } from './xlsxFileViewer';

export const XLSX_VIEW_TYPE = 'rich-table-xlsx';

/** The tab for an .xlsx file. All of the drawing is in XlsxFileViewer; this only forwards the view lifecycle. */
export class XlsxFileView extends FileView {
	private viewer: XlsxFileViewer;

	constructor(leaf: WorkspaceLeaf, plugin: BetterTablePlugin) {
		super(leaf);
		this.navigation = true;
		this.contentEl.addClass('bt-xlsx-file-view');
		this.viewer = new XlsxFileViewer(plugin, this.contentEl);
		this.addChild(this.viewer);
	}

	getViewType(): string {
		return XLSX_VIEW_TYPE;
	}

	getIcon(): string {
		return 'table';
	}

	canAcceptExtension(extension: string): boolean {
		return extension === 'xlsx';
	}

	setEphemeralState(state: unknown): void {
		super.setEphemeralState(state);
		const request = (state as { richSearch?: unknown } | null)?.richSearch;
		if (request) this.viewer.reveal(request);
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.viewer.open(file);
	}

	onUnloadFile(): Promise<void> {
		this.viewer.close();
		return Promise.resolve();
	}
}
