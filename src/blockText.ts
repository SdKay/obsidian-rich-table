import type { TextEdit } from './highlightText';

/** The lines a selection touches, as one range plus the lines themselves. */
function linesOf(text: string, from: number, to: number): { start: number; end: number; lines: string[] } {
	// A selection that ends right after a line break does not reach the next line.
	const last = to > from && text[to - 1] === '\n' ? to - 1 : Math.max(to, from);
	const start = from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1;
	const nl = text.indexOf('\n', last);
	const end = nl < 0 ? text.length : nl;
	return { start, end, lines: text.slice(start, end).split('\n') };
}

/** Blank lines inside a selection are left alone, unless every line is blank: then they all count. */
const skipsBlank = (lines: string[]): ((line: string) => boolean) => {
	const anyText = lines.some(l => l.trim() !== '');
	return line => anyText && line.trim() === '';
};

const replaceLines = (start: number, end: number, lines: string[], caret: boolean): TextEdit => {
	const replacement = lines.join('\n');
	const at = start + replacement.length;
	return { from: start, to: end, replacement, selFrom: caret ? at : start, selTo: at };
};

export type ListKind = 'bullet' | 'number' | 'task' | 'quote';

const LIST_PREFIX: Record<ListKind, RegExp> = {
	bullet: /^([-*+]) (?!\[[ xX]\] )/,
	number: /^\d+\. /,
	task: /^[-*+] \[[ xX]\] /,
	quote: /^> ?/,
};

/** Strips whichever list, task or quote prefix the line has. */
const stripPrefix = (line: string): string => line.replace(/^(?:[-*+] \[[ xX]\] |[-*+] |\d+\. |> ?)/, '');

const isKind = (line: string, kind: ListKind): boolean => LIST_PREFIX[kind].test(line);

/**
 * Turns the selected lines into a bullet, numbered or task list, or a quote; picking the kind they
 * all already are takes it off again. A line of another kind is switched, not stacked.
 */
export function toggleListKind(text: string, from: number, to: number, kind: ListKind): TextEdit {
	const { start, end, lines } = linesOf(text, from, to);
	const skip = skipsBlank(lines);
	const content = lines.filter(l => !skip(l));
	const off = content.length > 0 && content.every(l => isKind(l, kind));
	let n = 0;
	const out = lines.map(line => {
		if (skip(line)) return line;
		const body = stripPrefix(line);
		if (off) return body;
		n++;
		switch (kind) {
			case 'bullet': return `- ${body}`;
			case 'number': return `${n}. ${body}`;
			case 'task': return `- [ ] ${body}`;
			case 'quote': return `> ${body}`;
		}
	});
	return replaceLines(start, end, out, from === to);
}

/** Whether every non-empty selected line is of `kind`, for the menu's check mark. */
export function isListKind(text: string, from: number, to: number, kind: ListKind): boolean {
	const { lines } = linesOf(text, from, to);
	const skip = skipsBlank(lines);
	const content = lines.filter(l => !skip(l));
	return content.length > 0 && content.every(l => isKind(l, kind));
}

const HEADING = /^(#{1,6}) /;

/** Sets the selected lines to heading `level` (1–6), or to body text for 0. The same level again is body text. */
export function setHeading(text: string, from: number, to: number, level: number): TextEdit {
	const { start, end, lines } = linesOf(text, from, to);
	const same = headingLevel(text, from, to) === level;
	const skip = skipsBlank(lines);
	const out = lines.map(line => {
		if (skip(line)) return line;
		const body = line.replace(HEADING, '');
		return level === 0 || same ? body : `${'#'.repeat(level)} ${body}`;
	});
	return replaceLines(start, end, out, from === to);
}

/** The heading level all selected lines share (0 when none is a heading), or null when they differ. */
export function headingLevel(text: string, from: number, to: number): number | null {
	const { lines } = linesOf(text, from, to);
	const skip = skipsBlank(lines);
	const levels = lines.filter(l => !skip(l)).map(l => HEADING.exec(l)?.[1]?.length ?? 0);
	if (levels.length === 0) return null;
	return levels.every(v => v === levels[0]) ? levels[0]! : null;
}

/** Wraps the selection as `[[selection]]`, or as `[selection]()` with the caret in the brackets. */
export function insertLink(text: string, from: number, to: number, external: boolean): TextEdit | null {
	if (from >= to) return null;
	const body = text.slice(from, to);
	if (!external) return { from, to, replacement: `[[${body}]]`, selFrom: from + 2, selTo: from + 2 + body.length };
	const replacement = `[${body}]()`;
	const caret = from + replacement.length - 1;
	return { from, to, replacement, selFrom: caret, selTo: caret };
}

/** Puts the selection on its own lines between `open` and `close`, e.g. a code or math block. */
export function wrapBlock(text: string, from: number, to: number, open: string, close: string): TextEdit {
	const { start, end, lines } = linesOf(text, from, to);
	const body = lines.join('\n');
	const replacement = `${open}\n${body}\n${close}`;
	return { from: start, to: end, replacement, selFrom: start + open.length + 1, selTo: start + open.length + 1 + body.length };
}

/** Turns the selected lines into a callout of `type`. */
export function insertCallout(text: string, from: number, to: number, type = 'note'): TextEdit {
	const { start, end, lines } = linesOf(text, from, to);
	const replacement = [`> [!${type}]`, ...lines.map(l => `> ${stripPrefix(l)}`)].join('\n');
	return { from: start, to: end, replacement, selFrom: start, selTo: start + replacement.length };
}

/**
 * Adds a horizontal rule after the line the selection ends on. A blank line comes first: right
 * under text, `---` would turn that text into a heading.
 */
export function insertRule(text: string, from: number, to: number): TextEdit {
	const { end, lines } = linesOf(text, from, to);
	const blankAbove = (lines[lines.length - 1] ?? '').trim() === '';
	const replacement = blankAbove ? '\n---' : '\n\n---';
	const caret = end + replacement.length;
	return { from: end, to: end, replacement, selFrom: caret, selTo: caret };
}
