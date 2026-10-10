import { Menu } from 'obsidian';
import { t } from './i18n';
import { showMenuPinned } from './renderHoverPin';
import { HIGHLIGHT_COLORS, COLOR_LABEL_KEY, toggleHighlight, type HighlightColor } from './highlightText';

/** Selection as character offsets into the editor's textContent. */
function readSelection(editor: HTMLElement): { from: number; to: number } | null {
	const sel = activeWindow.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
	const offsetOf = (node: Node, offset: number) => {
		const before = activeDocument.createRange();
		before.selectNodeContents(editor);
		before.setEnd(node, offset);
		return before.toString().length;
	};
	return { from: offsetOf(range.startContainer, range.startOffset), to: offsetOf(range.endContainer, range.endOffset) };
}

function writeSelection(editor: HTMLElement, from: number, to: number): void {
	const walker = activeDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	const locate = (target: number): [Node, number] => {
		let seen = 0;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const len = n.textContent?.length ?? 0;
			if (target <= seen + len) return [n, target - seen];
			seen += len;
		}
		return [editor, editor.childNodes.length];
	};
	walker.currentNode = editor;
	const [startNode, startOffset] = locate(from);
	walker.currentNode = editor;
	const [endNode, endOffset] = locate(to);
	const range = activeDocument.createRange();
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);
	const sel = activeWindow.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

function applyHighlight(editor: HTMLElement, from: number, to: number, color?: HighlightColor): void {
	const edit = toggleHighlight(editor.textContent ?? '', from, to, color);
	if (!edit) return;
	editor.focus();
	writeSelection(editor, edit.from, edit.to);
	activeDocument.execCommand('insertText', false, edit.replacement);
	writeSelection(editor, edit.selFrom, edit.selTo);
}

/**
 * Replaces the editor's right-click menu so Obsidian's note-editor menu (and any
 * plugin hooked onto it) never sees a selection that lives in a table cell.
 * `onOpenChange(true)` is called while the menu is up: the editor loses focus to
 * it, and the caller must not treat that as the end of the edit.
 */
export function bindEditorContextMenu(editor: HTMLElement, onOpenChange: (open: boolean) => void): void {
	editor.addEventListener('contextmenu', (evt: MouseEvent) => {
		evt.preventDefault();
		evt.stopPropagation();
		const picked = readSelection(editor);
		const range = picked && picked.to > picked.from ? picked : null;

		const menu = new Menu();
		menu.addItem(item => item.setTitle(t('menuCut')).setIcon('scissors').setDisabled(!range)
			.onClick(() => { editor.focus(); if (picked) writeSelection(editor, picked.from, picked.to); activeDocument.execCommand('cut'); }));
		menu.addItem(item => item.setTitle(t('menuCopy')).setIcon('copy').setDisabled(!range)
			.onClick(() => { editor.focus(); if (picked) writeSelection(editor, picked.from, picked.to); activeDocument.execCommand('copy'); }));
		menu.addItem(item => item.setTitle(t('menuPaste')).setIcon('clipboard-paste')
			.onClick(() => {
				editor.focus();
				if (picked) writeSelection(editor, picked.from, picked.to);
				void activeWindow.navigator.clipboard.readText().then(text => { if (text) activeDocument.execCommand('insertText', false, text); });
			}));
		menu.addItem(item => item.setTitle(t('menuSelectAll')).setIcon('text-select')
			.onClick(() => { editor.focus(); writeSelection(editor, 0, (editor.textContent ?? '').length); }));
		menu.addSeparator();
		menu.addItem(item => item.setTitle(t('menuHighlight')).setIcon('highlighter').setDisabled(!range)
			.onClick(() => { if (range) applyHighlight(editor, range.from, range.to); }));
		for (const color of HIGHLIGHT_COLORS) {
			menu.addItem(item => item.setTitle(`${t('menuHighlight')} · ${t(COLOR_LABEL_KEY[color])}`).setIcon('highlighter').setDisabled(!range)
				.onClick(() => { if (range) applyHighlight(editor, range.from, range.to, color); }));
		}

		onOpenChange(true);
		menu.onHide(() => window.setTimeout(() => {
			onOpenChange(false);
			if (editor.isConnected) editor.focus();
		}, 0));
		showMenuPinned(menu, evt);
	});
}
