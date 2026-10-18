import { parseMarkdownPipeTable, parseHtmlTableWithMerges, type PastedRange } from './renderClipboard';

/** What the clipboard holds, read the same way whichever way the paste arrived. */
export interface ClipboardPayload {
	text: string;
	html: string;
}

export type PasteDecision =
	| { kind: 'grid'; values: string[][]; merges?: PastedRange['merges'] }
	| { kind: 'text'; text: string };

/**
 * One rule for pasting into a cell editor. A copied table spreads over cells, anything else
 * is plain text; `plain` ("Paste as plain text") never spreads. (Ctrl+Shift+V never reaches the
 * page: Obsidian pastes it into the note.)
 *
 * An HTML <table> wins over the plain text: Excel and Sheets send it, and so does Obsidian's own
 * "copy a rendered table", whose text/plain is the Markdown source rather than tab-separated, so
 * the cells must come from the HTML structure. A table typed by hand, or copied from another
 * note, GitHub or a chat reply, carries only text/plain, hence the pipe-table fallback.
 * Plain text is always taken from text/plain, never from the HTML: the HTML of `![[a.png]]`
 * copied out of a note is just "a.png".
 */
export function decidePaste(payload: ClipboardPayload, opts: { canSpread: boolean; plain?: boolean }): PasteDecision | null {
	if (opts.canSpread && !opts.plain) {
		const parsed = /<table[\s>]/i.test(payload.html) ? parseHtmlTableWithMerges(payload.html) : null;
		const values = parsed?.values ?? parseMarkdownPipeTable(payload.text);
		if (values) return { kind: 'grid', values, merges: parsed?.merges };
	}
	return payload.text ? { kind: 'text', text: payload.text } : null;
}

export function payloadOf(data: DataTransfer | null | undefined): ClipboardPayload {
	return { text: data?.getData('text/plain') ?? '', html: data?.getData('text/html') ?? '' };
}

/** Text as an HTML string that reads back as exactly that text. */
export const escapeForHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Inserts `text` at the caret as one undo step, keeping its line breaks as real "\n" characters.
 * `insertText` of multi-line text makes the browser split it into <div> blocks, which the cell's
 * saved value (textContent) reads as one run-together line; a line-by-line insertion keeps the
 * "\n" but folds into the typing before it, so one Ctrl+Z undoes both. `insertHTML` of the
 * escaped text gives a single text node with the "\n" in it. The escaping is what makes it safe:
 * without it a pasted "<b>" would become an element.
 */
export function insertPlainText(editor: HTMLElement, text: string): void {
	editor.focus();
	activeDocument.execCommand('insertHTML', false, escapeForHtml(text.replace(/\r\n?/g, '\n')));
}

// Electron's "paste as plain text" arrives as an ordinary `paste` event, so the menu click is
// what says the user asked for it. It expires so a later Ctrl+V is never taken for it.
const PLAIN_PASTE_WINDOW_MS = 1500;
let plainPasteAt = 0;

export const markPlainPaste = (): void => { plainPasteAt = Date.now(); };

/** True once for the paste that follows a "paste as plain text" click. */
export function takePlainPaste(): boolean {
	const asked = Date.now() - plainPasteAt < PLAIN_PASTE_WINDOW_MS;
	plainPasteAt = 0;
	return asked;
}
