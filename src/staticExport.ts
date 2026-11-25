/**
 * A rendered table as a page's worth of static HTML: no script, no number measured on the screen it was drawn on.
 * Whatever the page it is put into does to its width, the table and its frame stay together, because both are laid
 * out by the browser from the same CSS (STATIC_EXPORT_CSS) rather than placed from measurements.
 */
import { stripToTable } from './staticClone';

/**
 * The frame, drawn by the root itself so it follows the table's width. Selected with more classes than the plugin's own
 * `.bt-render-root.bt-render-root` padding rule and than a host's `.markdown-rendered div`, so it holds however the
 * stylesheets are ordered in the page.
 */
export const STATIC_EXPORT_CSS = `
.bt-export-book { width: fit-content; max-width: 100%; margin-inline: auto; }
.bt-export-radio { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.bt-export-panel { display: none; }
.bt-export-tabs label.bt-sheet-tab { cursor: pointer; }
.bt-render-root-shell.bt-export { display: block; }
.bt-export .bt-table-wrapper.bt-export-view { height: auto; max-height: none; }
.bt-render-root-shell.bt-export .bt-render-root.bt-render-root {
	box-sizing: border-box;
	width: fit-content;
	max-width: 100%;
	margin-inline: auto;
	padding: 0;
	border: var(--bt-outer-frame-border, 1px solid var(--background-modifier-border));
	border-radius: var(--bt-outer-frame-radius, var(--radius-m));
}
`;

export interface ExportedSheet {
	/** The shell element's markup, ready to put in a page that carries `STATIC_EXPORT_CSS` and the plugin's stylesheet. */
	html: string;
}

/** The cut-down copy of the rendered table in `shell` (a `.bt-render-root-shell`), as a detached element. `shell` is not changed. */
function cutDown(shell: HTMLElement): HTMLElement {
	const clone = shell.cloneNode(true) as HTMLElement;
	clone.querySelectorAll('.bt-outer-frame').forEach(el => el.remove());
	stripToTable(clone, 'bt-export-view');
	clone.querySelector<HTMLElement>('.bt-render-root')?.style.removeProperty('--bt-sel-pad');
	clone.style.removeProperty('visibility');
	clone.classList.add('bt-export');
	return clone;
}

/** Cuts the rendered table in `shell` (a `.bt-render-root-shell`) down to what a page can hold. `shell` is not changed. */
export function exportSheetHtml(shell: HTMLElement): ExportedSheet {
	return { html: cutDown(shell).outerHTML };
}

export interface ExportSheetInput {
	id: string;
	name: string;
	tabColor?: string;
	tabTextColor?: string;
	/** The sheet's rendered `.bt-render-root-shell`. */
	shell: HTMLElement;
}

/**
 * A workbook as one block of HTML: every sheet is a panel, the tabs are labels for hidden radio buttons, and which panel
 * shows is decided by `:checked` in CSS alone. `idPrefix` makes the radio group and its ids unique within the page, so a
 * page can hold several workbooks; the few rules that name those ids travel with the block, as many as it has sheets.
 * The sheets are drawn by the caller; none of them is changed.
 */
export function exportWorkbookHtml(sheets: ExportSheetInput[], opts: { idPrefix: string; activeSheetId?: string }): ExportedSheet {
	const active = Math.max(0, sheets.findIndex(s => s.id === opts.activeSheetId));
	const idOf = (i: number) => `${opts.idPrefix}-${i}`;
	const book = createDiv({ cls: 'bt-export-book' });
	sheets.forEach((_, i) => {
		const radio = book.createEl('input', { cls: 'bt-export-radio', attr: { type: 'radio', name: opts.idPrefix, id: idOf(i) } });
		if (i === active) radio.setAttribute('checked', '');
	});
	const panels = book.createDiv({ cls: 'bt-export-panels' });
	for (const sheet of sheets) panels.createDiv({ cls: 'bt-export-panel' }).appendChild(cutDown(sheet.shell));
	const tabs = book.createDiv({ cls: 'bt-export-tabs bt-sheet-tabbar' });
	sheets.forEach((sheet, i) => {
		const tab = tabs.createEl('label', { cls: 'bt-sheet-tab', attr: { for: idOf(i) } });
		if (sheet.tabColor) tab.style.setProperty('--bt-sheet-tab-bg', sheet.tabColor);
		if (sheet.tabTextColor) tab.style.setProperty('--bt-sheet-tab-color', sheet.tabTextColor);
		tab.createSpan({ cls: 'bt-sheet-tab-label', text: sheet.name });
	});
	// The rules go in as text, in front of the block: this is markup for a page outside Obsidian, not a style added to one.
	return { html: `<style>${sheets.map((_, n) => workbookRules(idOf(n), n + 1)).join('\n')}</style>${book.outerHTML}` };
}

/** What the n-th radio (1-based, `id`) being checked does: shows the n-th panel and gives the n-th tab the open tab's look. */
function workbookRules(id: string, n: number): string {
	const checked = `#${CSS.escape(id)}:checked`;
	return `${checked} ~ .bt-export-panels > .bt-export-panel:nth-child(${n}) { display: block; }\n`
		+ `${checked} ~ .bt-export-tabs > .bt-sheet-tab:nth-child(${n}) { color: var(--bt-sheet-tab-color, var(--text-normal)); background: var(--bt-sheet-tab-bg, var(--background-primary)); border-color: var(--bt-sheet-tab-bg, var(--interactive-accent)); box-shadow: var(--shadow-s); font-weight: var(--font-semibold); }`;
}
