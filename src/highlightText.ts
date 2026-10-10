export const HIGHLIGHT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type HighlightColor = typeof HIGHLIGHT_COLORS[number];

export const COLOR_MARK: Record<HighlightColor, string> = {
	red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣',
};
const MARKS = Object.values(COLOR_MARK);

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
