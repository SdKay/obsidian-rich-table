export const HIGHLIGHT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type HighlightColor = typeof HIGHLIGHT_COLORS[number];

export const COLOR_MARK: Record<HighlightColor, string> = {
	red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣',
};
const MARKS = Object.values(COLOR_MARK);
// Obsidian reads the square dots as the same colors.
const SQUARE_MARK: Record<HighlightColor, string> = {
	red: '🟥', orange: '🟧', yellow: '🟨', green: '🟩', blue: '🟦', purple: '🟪',
};
const ALL_MARKS: [string, HighlightColor][] = HIGHLIGHT_COLORS.flatMap(c => [[COLOR_MARK[c], c], [SQUARE_MARK[c], c]] as [string, HighlightColor][]);

export const COLOR_LABEL_KEY = {
	red: 'highlightRed', orange: 'highlightOrange', yellow: 'highlightYellow',
	green: 'highlightGreen', blue: 'highlightBlue', purple: 'highlightPurple',
} as const satisfies Record<HighlightColor, string>;

export interface TextEdit {
	/** Range of the original text to replace. */
	from: number;
	to: number;
	replacement: string;
	/** Selection to restore, as offsets into the NEW text. */
	selFrom: number;
	selTo: number;
}

/** Splits `==🔴body==` into its parts; null when `s` is not exactly one highlight. */
function parseHighlight(s: string): { mark: string; body: string } | null {
	if (s.length < 4 || !s.startsWith('==') || !s.endsWith('==')) return null;
	const inner = s.slice(2, -2);
	const mark = MARKS.find(m => inner.startsWith(m)) ?? '';
	return { mark, body: inner.slice(mark.length) };
}

/**
 * Applies a highlight to `text[from, to)`, or removes it when the selection
 * already is one (or sits exactly inside one). A different color on an existing
 * highlight recolors it; the same color toggles it off.
 */
export function toggleHighlight(text: string, from: number, to: number, color?: HighlightColor): TextEdit | null {
	if (from >= to) return null;
	const wanted = color ? COLOR_MARK[color] : '';
	const wrap = (start: number, end: number, body: string, mark: string): TextEdit => {
		const replacement = `==${mark}${body}==`;
		return { from: start, to: end, replacement, selFrom: start + 2 + mark.length, selTo: start + 2 + mark.length + body.length };
	};
	const unwrap = (start: number, end: number, body: string): TextEdit =>
		({ from: start, to: end, replacement: body, selFrom: start, selTo: start + body.length });

	const selected = parseHighlight(text.slice(from, to));
	if (selected) return selected.mark === wanted ? unwrap(from, to, selected.body) : wrap(from, to, selected.body, wanted);

	// Selection is the body of a highlight: look for the markers around it.
	for (const mark of ['', ...MARKS]) {
		const open = from - 2 - mark.length;
		if (open < 0 || text.slice(open, open + 2 + mark.length) !== `==${mark}` || text.slice(to, to + 2) !== '==') continue;
		if (mark === '' && MARKS.some(m => text.startsWith(m, from))) continue;
		const body = text.slice(from, to);
		return mark === wanted ? unwrap(open, to + 2, body) : wrap(open, to + 2, body, wanted);
	}
	return wrap(from, to, text.slice(from, to), wanted);
}

/**
 * The highlight the selection is in: '' for an uncolored one, the color name, or null when it
 * is not highlighted. The selection may be the whole `==…==`, its body, or part of the body.
 */
export function highlightAt(text: string, from: number, to: number): HighlightColor | '' | null {
	if (from >= to) return null;
	const colorOf = (inner: string): HighlightColor | '' => ALL_MARKS.find(([m]) => inner.startsWith(m))?.[1] ?? '';
	const whole = text.slice(from, to);
	if (whole.length >= 4 && whole.startsWith('==') && whole.endsWith('==')) return colorOf(whole.slice(2));
	// The `==` marks of a line alternate open, close, …; the highlight around the selection is the pair that holds it.
	const lineStart = text.lastIndexOf('\n', from - 1) + 1;
	const nl = text.indexOf('\n', to);
	const lineEnd = nl < 0 ? text.length : nl;
	const marks: number[] = [];
	for (let at = text.indexOf('==', lineStart); at >= 0 && at + 2 <= lineEnd; at = text.indexOf('==', at + 2)) marks.push(at);
	for (let i = 0; i + 1 < marks.length; i += 2) {
		const open = marks[i]!;
		const close = marks[i + 1]!;
		const inner = text.slice(open + 2, close);
		const dot = ALL_MARKS.find(([m]) => inner.startsWith(m));
		const bodyStart = open + 2 + (dot ? dot[0].length : 0);
		if (bodyStart <= from && to <= close) return dot ? dot[1] : '';
		// The selection starts inside the dot or on the `==`: not inside this highlight's body.
	}
	return null;
}
