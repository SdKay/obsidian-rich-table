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
.bt-render-root-shell.bt-export { display: block; }
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

/** Cuts the rendered table in `shell` (a `.bt-render-root-shell`) down to what a page can hold. `shell` is not changed. */
export function exportSheetHtml(shell: HTMLElement): ExportedSheet {
	const clone = shell.cloneNode(true) as HTMLElement;
	clone.querySelectorAll('.bt-outer-frame').forEach(el => el.remove());
	stripToTable(clone);
	clone.querySelector<HTMLElement>('.bt-render-root')?.style.removeProperty('--bt-sel-pad');
	clone.style.removeProperty('visibility');
	clone.classList.add('bt-export');
	return { html: clone.outerHTML };
}
