import type { Menu } from 'obsidian';
import { fmt, t } from './i18n';
import { insertPlainText, markPlainPaste } from './editorPaste';
import { HIGHLIGHT_COLORS, COLOR_LABEL_KEY, toggleHighlight, highlightAt, type HighlightColor, type TextEdit } from './highlightText';
import { insertCallout, insertLink, insertRule, isListKind, headingLevel, setHeading, toggleListKind, wrapBlock, type ListKind } from './blockText';
import { clearFormat, hasFormat, layerRanges, toggleFormat, type FormatKind } from './formatText';

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

function applyEdit(editor: HTMLElement, edit: TextEdit | null): void {
	if (!edit) return;
	editor.focus();
	writeSelection(editor, edit.from, edit.to);
	insertPlainText(editor, edit.replacement);
	writeSelection(editor, edit.selFrom, edit.selTo);
}

interface CellPick { editor: HTMLElement; from: number; to: number }
let picked: CellPick | null = null;

/**
 * Leaves the right-click to Obsidian's own menu and only records which cell text it was
 * opened on. The native items act on the note's editor, so highlighting needs its own items.
 * `onOpenChange(true)` holds the cell's blur-to-save until the click that dismisses the menu.
 */
export function trackCellContextMenu(editor: HTMLElement, onOpenChange: (open: boolean) => void): void {
	editor.addEventListener('contextmenu', () => {
		const sel = readSelection(editor);
		picked = sel ? { editor, ...sel } : null;
		onOpenChange(true);
		const end = (evt: Event) => {
			if (evt.target instanceof Element && evt.target.closest('.menu')) return;
			activeDocument.removeEventListener('mousedown', end, true);
			activeDocument.removeEventListener('keydown', end, true);
			onOpenChange(false);
		};
		activeDocument.addEventListener('mousedown', end, true);
		activeDocument.addEventListener('keydown', end, true);
	}, true);
}

/** Forgets the recorded cell when the right-click was anywhere else. */
export function clearCellPickOutside(evt: MouseEvent): void {
	if (picked && !(evt.target instanceof Node && picked.editor.contains(evt.target))) picked = null;
}

/** Adds the cell highlight group to Obsidian's menu when it was opened on cell text. */
export function addCellHighlightItems(menu: Menu): void {
	const pick = picked;
	if (!pick?.editor.isConnected) return;
	// The native text-format, list, heading and link items edit the note, not the cell.
	const native = menu as unknown as { items?: { section?: string; dom?: HTMLElement }[] };
	// Clipboard group: cut, copy, paste, paste as plain text, select all.
	const plainPaste = native.items?.filter(i => i.section === 'clipboard')[3];
	plainPaste?.dom?.addEventListener('click', markPlainPaste, true);
	if (native.items) {
		for (let i = native.items.length - 1; i >= 0; i--) {
			const item = native.items[i];
			if (!item?.section?.startsWith('selection')) continue;
			item.dom?.remove();
			native.items.splice(i, 1);
		}
	}
	menu.addSeparator();
	const sub = (item: import('obsidian').MenuItem): Menu | undefined => (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
	const run = (edit: (text: string) => TextEdit | null) => () => applyEdit(pick.editor, edit(pick.editor.textContent ?? ''));
	const has = pick.to > pick.from;

	menu.addItem(i => i.setTitle(t('blockLink')).setIcon('link').setDisabled(!has)
		.onClick(run(x => insertLink(x, pick.from, pick.to, false))));
	menu.addItem(i => i.setTitle(t('blockExternalLink')).setIcon('external-link').setDisabled(!has)
		.onClick(run(x => insertLink(x, pick.from, pick.to, true))));
	menu.addSeparator();
	menu.addItem(item => {
		item.setTitle(t('menuCellFormat')).setIcon('paintbrush').setDisabled(!has);
		const formats = sub(item);
		fillFormatMenu(formats ?? menu, pick, !formats);
	});
	menu.addItem(i => {
		i.setTitle(t('blockParagraph')).setIcon('pilcrow');
		const inner = sub(i);
		fillParagraphMenu(inner ?? menu, pick, !inner);
	});
	menu.addItem(i => {
		i.setTitle(t('blockInsert')).setIcon('plus-circle');
		const inner = sub(i);
		fillInsertMenu(inner ?? menu, pick, !inner);
	});
}

const FORMAT_ITEMS: { kind: FormatKind; title: () => string; icon: string }[] = [
	{ kind: 'bold', title: () => t('formatBold'), icon: 'bold' },
	{ kind: 'italic', title: () => t('formatItalic'), icon: 'italic' },
	{ kind: 'strike', title: () => t('formatStrike'), icon: 'strikethrough' },
];
const FORMAT_ITEMS_ADVANCED: typeof FORMAT_ITEMS = [
	{ kind: 'code', title: () => t('formatCode'), icon: 'code' },
	{ kind: 'math', title: () => t('formatMath'), icon: 'sigma' },
	{ kind: 'comment', title: () => t('formatComment'), icon: 'percent' },
];

/** The same entries and order as Obsidian's own Format submenu; `flat` prefixes titles when no submenu is available. */
function fillFormatMenu(menu: Menu, pick: CellPick, flat: boolean): void {
	const text = pick.editor.textContent ?? '';
	const prefix = flat ? `${t('menuCellFormat')} · ` : '';
	const toggle = (m: { kind: FormatKind; title: () => string; icon: string }) => menu.addItem(i => i
		.setTitle(prefix + m.title()).setIcon(m.icon).setChecked(hasFormat(text, pick.from, pick.to, m.kind))
		.onClick(() => applyEdit(pick.editor, toggleFormat(pick.editor.textContent ?? '', pick.from, pick.to, m.kind))));
	// A highlight may sit around bold and the like, so look through the layers for it.
	let current: ReturnType<typeof highlightAt> = null;
	let inHighlight: [number, number] = [pick.from, pick.to];
	for (const [s, e] of layerRanges(text, pick.from, pick.to)) {
		const found = highlightAt(text, s, e);
		if (found !== null) { current = found; inHighlight = [s, e]; break; }
	}
	/** `color` undefined is the default highlight; its swatch is the pen icon, colors get Obsidian's dot. */
	const highlight = (title: string, color?: HighlightColor) => (i: import('obsidian').MenuItem) => {
		i.setTitle(prefix + title).setChecked(current === (color ?? ''))
			.onClick(() => applyEdit(pick.editor, toggleHighlight(pick.editor.textContent ?? '', inHighlight[0], inHighlight[1], color)));
		const iconEl = (i as unknown as { iconEl?: HTMLElement }).iconEl;
		if (color && iconEl) iconEl.createDiv({ cls: 'highlight-swatch', attr: { 'data-highlight': color } });
		else i.setIcon('highlighter');
	};

	FORMAT_ITEMS.forEach(toggle);
	if (flat) {
		menu.addItem(highlight(t('formatHighlight')));
		for (const color of HIGHLIGHT_COLORS) menu.addItem(highlight(`${t('formatHighlight')} · ${t(COLOR_LABEL_KEY[color])}`, color));
	} else {
		menu.addItem(i => {
			i.setTitle(t('formatHighlight')).setIcon('highlighter').setChecked(current !== null);
			const colors = (i as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
			if (!colors) return;
			colors.addItem(highlight(t('highlightDefault')));
			for (const color of HIGHLIGHT_COLORS) colors.addItem(highlight(t(COLOR_LABEL_KEY[color]), color));
		});
	}
	menu.addSeparator();
	FORMAT_ITEMS_ADVANCED.forEach(toggle);
	menu.addSeparator();
	menu.addItem(i => i.setTitle(prefix + t('formatClear')).setIcon('eraser')
		.onClick(() => applyEdit(pick.editor, clearFormat(pick.editor.textContent ?? '', pick.from, pick.to))));
}

type Entry = { title: string; icon: string; checked?: boolean; edit: (text: string) => TextEdit | null };

function addEntries(menu: Menu, pick: CellPick, flat: boolean, label: string, entries: Entry[]): void {
	const prefix = flat ? `${label} · ` : '';
	for (const e of entries) {
		menu.addItem(i => {
			i.setTitle(prefix + e.title).setIcon(e.icon).onClick(() => applyEdit(pick.editor, e.edit(pick.editor.textContent ?? '')));
			if (e.checked !== undefined) i.setChecked(e.checked);
		});
	}
}

/** Lists, quote and headings, the same entries and order as Obsidian's Paragraph submenu. */
function fillParagraphMenu(menu: Menu, pick: CellPick, flat: boolean): void {
	const text = pick.editor.textContent ?? '';
	const label = t('blockParagraph');
	const list = (kind: ListKind, title: string, icon: string): Entry => ({ title, icon, edit: x => toggleListKind(x, pick.from, pick.to, kind) });
	addEntries(menu, pick, flat, label, [
		list('bullet', t('blockBullet'), 'list'),
		list('number', t('blockNumbered'), 'list-ordered'),
		list('task', t('blockTask'), 'check-square'),
	]);
	menu.addSeparator();
	const level = headingLevel(text, pick.from, pick.to);
	addEntries(menu, pick, flat, label, [
		...[1, 2, 3, 4, 5, 6].map((n): Entry => ({
			title: fmt('blockHeading', { n }), icon: `heading-${n}`, checked: level === n, edit: x => setHeading(x, pick.from, pick.to, n),
		})),
		{ title: t('blockBody'), icon: 'text', checked: level === 0, edit: x => setHeading(x, pick.from, pick.to, 0) },
	]);
	menu.addSeparator();
	addEntries(menu, pick, flat, label, [
		{ ...list('quote', t('blockQuote'), 'quote'), checked: isListKind(text, pick.from, pick.to, 'quote') },
	]);
}

/** Callout, rule, code and math blocks, the same entries and order as Obsidian's Insert submenu. */
function fillInsertMenu(menu: Menu, pick: CellPick, flat: boolean): void {
	const label = t('blockInsert');
	addEntries(menu, pick, flat, label, [
		{ title: t('blockCallout'), icon: 'quote', edit: x => insertCallout(x, pick.from, pick.to) },
		{ title: t('blockRule'), icon: 'minus', edit: x => insertRule(x, pick.from, pick.to) },
	]);
	menu.addSeparator();
	addEntries(menu, pick, flat, label, [
		{ title: t('blockCode'), icon: 'code', edit: x => wrapBlock(x, pick.from, pick.to, '```', '```') },
		{ title: t('blockMath'), icon: 'sigma-square', edit: x => wrapBlock(x, pick.from, pick.to, '$$', '$$') },
	]);
}
