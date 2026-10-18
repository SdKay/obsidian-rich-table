import { COLOR_MARK, type TextEdit } from './highlightText';

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'math' | 'comment';

export const FORMAT_MARK: Record<FormatKind, string> = {
	bold: '**', italic: '*', strike: '~~', code: '`', math: '$', comment: '%%',
};

const MARKS = Object.values(COLOR_MARK);

/** Length of the run of `*` that contains `at`. */
function starRun(text: string, at: number): number {
	let a = at;
	let b = at;
	while (a > 0 && text[a - 1] === '*') a--;
	while (b < text.length - 1 && text[b + 1] === '*') b++;
	return b - a + 1;
}

/** A `*` marks italics in a run of one, or of three (bold italic); a run of two is bold's. */
const italicStar = (text: string, at: number): boolean => [1, 3].includes(starRun(text, at));

/** The selection is wrapped by `mark` (inside it, or just outside it). */
function wrapped(text: string, from: number, to: number, mark: string): { open: number; close: number } | null {
	const n = mark.length;
	const lone = (at: number) => mark !== '*' || italicStar(text, at);
	if (to - from >= 2 * n && text.startsWith(mark, from) && text.startsWith(mark, to - n) && lone(from) && lone(to - n)) {
		return { open: from, close: to - n };
	}
	if (from >= n && text.startsWith(mark, from - n) && text.startsWith(mark, to) && lone(from - n) && lone(to)) {
		return { open: from - n, close: to };
	}
	return null;
}

// Longest first so `**` is taken before `*`.
const CLEARABLE = ['**', '~~', '==', '%%', '`', '$', '*'];

/**
 * The nearest pair of `mark` around `[s, e)` on its own line, with no further `mark` between
 * the pair and the selection: `[open, close)` covers the marks too. `**a** b **c**` has no pair
 * around `b`.
 */
function enclosing(text: string, s: number, e: number, mark: string, dot: string): { open: number; close: number } | null {
	const n = mark.length;
	const isMark = (at: number) => text.startsWith(mark, at) && (mark !== '*' || italicStar(text, at));
	const lineStart = text.lastIndexOf('\n', s - 1) + 1;
	const nl = text.indexOf('\n', e);
	const lineEnd = nl < 0 ? text.length : nl;
	// Marks on the line alternate open, close, open, …: the pair around the selection is the one
	// whose opening mark has an even number of marks before it.
	const marks: number[] = [];
	for (let at = lineStart; at + n <= lineEnd; at++) {
		if (!isMark(at)) continue;
		marks.push(at);
		at += n - 1;
	}
	for (let i = 0; i + 1 < marks.length; i += 2) {
		const open = marks[i]!;
		const close = marks[i + 1]!;
		if (open + n + dot.length <= s && e <= close && text.startsWith(dot, open + n)) {
			return { open, close: close + n };
		}
	}
	return null;
}

/**
 * The selection and every range reached by peeling a layer of marks off it: marks right outside
 * it, marks it carries inside, or a pair further out that merely encloses it. `==🔴**aaa**==`
 * selected whole, or just `aaa`, reaches the same ranges, so each mark is found however the
 * others nest around it.
 */
export function layerRanges(text: string, from: number, to: number): [number, number][] {
	const seen = new Set<string>();
	const out: [number, number][] = [];
	const queue: [number, number][] = [[from, to]];
	while (queue.length > 0 && out.length < 24) {
		const [s, e] = queue.shift()!;
		const key = `${s}:${e}`;
		if (s >= e || seen.has(key)) continue;
		seen.add(key);
		out.push([s, e]);
		for (const mark of CLEARABLE) {
			const n = mark.length;
			const half = (at: number) => mark === '*' && !italicStar(text, at);
			const dots = mark === '==' ? ['', ...MARKS] : [''];
			for (const dot of dots) {
				const open = n + dot.length;
				if (e - s >= n + open && text.startsWith(mark + dot, s) && text.startsWith(mark, e - n) && !half(s) && !half(e - n)) {
					queue.push([s + open, e - n]);
				}
				if (s >= open && text.startsWith(mark + dot, s - open) && text.startsWith(mark, e) && !half(s - open) && !half(e)) {
					queue.push([s - open, e + n]);
				}
			}
			for (const dot of dots) {
				const around = enclosing(text, s, e, mark, dot);
				if (!around) continue;
				const n2 = mark.length + dot.length;
				queue.push([around.open, around.close], [around.open + n2, around.close - mark.length]);
			}
		}
	}
	return out;
}

/** True when the selection already carries `kind`, for the menu's check mark. */
export function hasFormat(text: string, from: number, to: number, kind: FormatKind): boolean {
	const mark = FORMAT_MARK[kind];
	return from < to && layerRanges(text, from, to).some(([s, e]) => wrapped(text, s, e, mark) !== null);
}

/** Wraps `text[from, to)` in the mark of `kind`, or unwraps it when it already is. */
export function toggleFormat(text: string, from: number, to: number, kind: FormatKind): TextEdit | null {
	if (from >= to) return null;
	const mark = FORMAT_MARK[kind];
	const found = layerRanges(text, from, to).map(([s, e]) => wrapped(text, s, e, mark)).find(r => r !== null) ?? null;
	if (found) {
		const body = text.slice(found.open + mark.length, found.close);
		const end = found.close + mark.length;
		return { from: found.open, to: end, replacement: body, selFrom: found.open, selTo: found.open + body.length };
	}
	const body = text.slice(from, to);
	return {
		from, to, replacement: `${mark}${body}${mark}`,
		selFrom: from + mark.length, selTo: from + mark.length + body.length,
	};
}

/** Removes the Markdown marks (and highlight color dots) around and inside the selection. */
export function clearFormat(text: string, from: number, to: number): TextEdit | null {
	if (from >= to) return null;
	let start = from;
	let end = to;
	// Peel marks that sit right outside the selection, as long as they pair up. A highlight's
	// color dot sits between its `==` and the text, so it is stepped over with the opening mark.
	for (let changed = true; changed;) {
		changed = false;
		for (const mark of CLEARABLE) {
			const n = mark.length;
			if (!text.startsWith(mark, end)) continue;
			const dot = mark === '==' ? MARKS.find(m => start >= n + m.length && text.startsWith(m, start - m.length) && text.startsWith(mark, start - m.length - n)) : undefined;
			const open = dot ? start - dot.length - n : start - n;
			if (open >= 0 && (dot || text.startsWith(mark, open))) {
				start = open; end += n; changed = true;
			}
		}
	}
	let body = text.slice(start, end);
	// Then the marks that wrap the selection from inside.
	for (let changed = true; changed;) {
		changed = false;
		for (const mark of CLEARABLE) {
			const n = mark.length;
			if (body.length >= 2 * n && body.startsWith(mark) && body.endsWith(mark)) {
				body = body.slice(n, -n); changed = true;
			}
		}
		for (const dot of MARKS) {
			if (body.startsWith(dot)) { body = body.slice(dot.length); changed = true; }
		}
	}
	if (start === from && end === to && body === text.slice(from, to)) return null;
	return { from: start, to: end, replacement: body, selFrom: start, selTo: start + body.length };
}
