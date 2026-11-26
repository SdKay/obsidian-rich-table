import type { App, Component } from 'obsidian';
import type { BlockExportProvider, BlockExportRequest, BlockExportResult } from './blockExportApi';
import type { ChoiceRegistry } from './choiceRegistry';
import type { TableModelV2, WorkbookV3 } from './model';
import { parseSource, readBlock } from './parser';
import { renderTable } from './renderer';
import { shellStyled, whenStylesReady } from './stylesReady';
import { exportSheetHtml, exportWorkbookHtml, STATIC_EXPORT_CSS, type ExportSheetInput } from './staticExport';
import { EXPORT_BASE_CSS, EXPORT_PAGE_VARIABLES } from './staticExportCss.generated';
import { CURRENT_TABLE_VERSION } from './tableVersion';

/** Goes up whenever the markup or the stylesheet an export returns changes for the same block. */
export const BLOCK_EXPORT_VERSION = 1;
const LANGUAGES = ['rich-table'];
/** Where a sheet is drawn before it is cut down: in the page, so the stylesheet applies, and off the screen. */
const HOST_CLASS = 'bt-export-host';

export interface BlockExportHost {
	app: App;
	/** Read on every export: the user's own column types can change while the plugin runs. */
	choiceRegistry: () => ChoiceRegistry;
	/** A lifecycle owner for the drawing, unloaded when the export is done. */
	newComponent(): Component;
}

/** The sheets a block holds: its one table, or every sheet of its workbook. */
function sheetsOf(doc: TableModelV2 | WorkbookV3): { id: string; name: string; tabColor?: string; tabTextColor?: string; model: TableModelV2 }[] {
	if (doc.version !== 3) return [{ id: 'sheet', name: '', model: doc }];
	return doc.sheets.map((s, i) => ({ id: s.id, name: s.name || `Sheet${i + 1}`, tabColor: s.tabColor, tabTextColor: s.tabTextColor, model: s }));
}

/** The stylesheet an export comes with: what an exported table needs from styles.css, and the rules of the export itself. */
export function exportCss(): string {
	return `${EXPORT_BASE_CSS}\n${STATIC_EXPORT_CSS}`;
}

/** Waits until the stylesheet is styling `shell`, so the geometry read from it afterwards is the page's. */
function styled(shell: HTMLElement): Promise<void> {
	return new Promise(resolve => whenStylesReady(resolve, { isReady: () => shellStyled(shell), nextFrame: fn => { window.requestAnimationFrame(fn); } }));
}

/**
 * The object rich-table publishes as `plugin.blockExport` so another plugin can turn a `rich-table` block into static
 * HTML. Free of the plugin class, so it can be tested on its own.
 */
export function createBlockExportProvider(host: BlockExportHost): BlockExportProvider {
	return {
		apiVersion: 1,
		languages: LANGUAGES,
		exportVersion: BLOCK_EXPORT_VERSION,
		export: request => exportBlock(host, request),
	};
}

async function exportBlock(host: BlockExportHost, request: BlockExportRequest): Promise<BlockExportResult> {
	if (!LANGUAGES.includes(request.language)) return { ok: false, error: `Rich Table does not export "${request.language}" blocks` };
	const read = readBlock(request.source);
	if (read.kind === 'empty') return { ok: false, error: 'The block is empty' };
	if (read.kind === 'too-new') return { ok: false, error: `The block was written by a newer Rich Table (format ${read.version}; this one reads up to ${CURRENT_TABLE_VERSION})` };
	if (read.kind === 'unreadable') return { ok: false, error: read.yamlError ? `The block could not be read: ${read.yamlError}` : 'The block is not a table this version reads' };

	const component = host.newComponent();
	const screen = createDiv({ cls: HOST_CLASS });
	if (request.width !== undefined && request.width > 0) screen.setCssProps({ width: `${request.width}px` });
	activeDocument.body.appendChild(screen);
	try {
		const doc = parseSource(request.source);
		const drawn: ExportSheetInput[] = [];
		for (const sheet of sheetsOf(doc)) {
			const el = screen.createDiv();
			// A sheet with no column draws nothing, so it has no shell and is left out.
			await renderTable(sheet.model, host.choiceRegistry, el, host.app, request.sourcePath, component);
			const shell = el.querySelector<HTMLElement>('.bt-render-root-shell');
			if (!shell) continue;
			await styled(shell);
			drawn.push({ id: sheet.id, name: sheet.name, tabColor: sheet.tabColor, tabTextColor: sheet.tabTextColor, shell });
		}
		if (drawn.length === 0) return { ok: false, error: 'The block has no table to show' };
		const first = drawn[0]!;
		const html = doc.version === 3 && drawn.length > 1
			? exportWorkbookHtml(drawn, { idPrefix: `bt-wb-${Math.random().toString(36).slice(2, 8)}`, activeSheetId: doc.activeSheetId }).html
			: exportSheetHtml(first.shell).html;
		return { ok: true, value: { html, css: { id: `rich-table-${BLOCK_EXPORT_VERSION}`, text: exportCss() }, variables: { ...EXPORT_PAGE_VARIABLES } } };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		screen.remove();
		component.unload();
	}
}
