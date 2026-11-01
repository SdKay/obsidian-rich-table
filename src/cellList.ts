/** Markers of an unordered list, by depth; deeper than the last repeats from the start. */
export const BULLET_MARKERS = ['•', '◦', '▪'] as const;

export function bulletMarker(depth: number): string {
	return BULLET_MARKERS[depth % BULLET_MARKERS.length] ?? '•';
}

let anyStartNumber = false;

/** Whether an ordered list counts on from the number its first item is written with. Set from the settings. */
export const setListStartAnyNumber = (on: boolean): void => { anyStartNumber = on; };
export const listStartAnyNumber = (): boolean => anyStartNumber;

/** One line of a flattened list. `body` holds the item's own content, without its nested lists. */
export interface ListLine {
	depth: number;
	marker: string;
	body: Node[];
}

const isList = (n: Node): n is HTMLElement => n.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((n as HTMLElement).tagName);

/**
 * Reads a rendered `<ul>`/`<ol>` into lines, nested lists included, in reading order. An ordered
 * list numbers its own items, whatever the depth: from 1, or with `fromStart` from the number
 * its `start` attribute (the first item as written) gives.
 */
export function listLines(list: HTMLElement, depth = 0, fromStart = false): ListLine[] {
	const ordered = list.tagName === 'OL';
	const first = ordered && fromStart ? Number((list as HTMLOListElement).getAttribute('start') ?? 1) || 1 : 1;
	const lines: ListLine[] = [];
	let n = first - 1;
	for (const item of Array.from(list.children)) {
		if (item.tagName !== 'LI') continue;
		n++;
		const body: Node[] = [];
		const nested: HTMLElement[] = [];
		for (const child of Array.from(item.childNodes)) (isList(child) ? nested : body).push(child);
		lines.push({ depth, marker: ordered ? `${n}.` : bulletMarker(depth), body });
		for (const inner of nested) lines.push(...listLines(inner, depth + 1, fromStart));
	}
	return lines;
}

/** A line of list text: its indent, its marker (`-` or `3.`) and what follows the marker. */
export interface ListItemText {
	indent: string;
	marker: string;
	ordered: boolean;
	content: string;
}

const ITEM = /^( *)(?:([-*+])|(\d+)\.) (.*)$/;

export function parseListItem(line: string): ListItemText | null {
	const m = ITEM.exec(line);
	if (!m) return null;
	const ordered = m[3] !== undefined;
	return { indent: m[1] ?? '', marker: ordered ? `${m[3]}.` : (m[2] ?? '-'), ordered, content: m[4] ?? '' };
}

/** The marker that follows `item` on the same level: a bullet repeats, a number goes up by one. */
export function nextMarker(item: ListItemText): string {
	return item.ordered ? `${Number.parseInt(item.marker, 10) + 1}.` : item.marker;
}

/** What a line break after `line` starts with, or null when `line` is not a list item. */
export function continueList(line: string): string | null {
	const item = parseListItem(line);
	return item ? `${item.indent}${nextMarker(item)} ` : null;
}

/**
 * What Backspace does at the end of `line` when `before` are the lines above it. A line that is only a
 * marker loses its trailing space and then the marker; a line left with only indent goes up one level
 * and takes that level's next marker. Null means Backspace is left to the browser.
 */
export function backspaceInList(line: string, before: string[]): { replaceWith: string } | null {
	const bare = /^( *)(?:[-*+]|\d+\.) $/.exec(line);
	if (bare) return { replaceWith: line.slice(0, -1) };
	const marker = /^( *)(?:[-*+]|\d+\.)$/.exec(line);
	if (marker) return { replaceWith: marker[1] ?? '' };
	const indentOnly = /^( +)$/.exec(line);
	if (!indentOnly) return null;
	const depth = (indentOnly[1] ?? '').length;
	for (let i = before.length - 1; i >= 0; i--) {
		const item = parseListItem(before[i] ?? '');
		if (!item) return null;
		if (item.indent.length < depth) return { replaceWith: `${item.indent}${nextMarker(item)} ` };
	}
	return null;
}

/**
 * Numbers the ordered lists in a cell's text the way they are shown: from 1, or from the number the first
 * item is written with, and one more for each item after it. A list is the run of numbered lines at one
 * indent; a line indented less, a bullet or a plain line ends it, and a deeper line numbers on its own.
 */
export function renumberLists(text: string, fromFirst: boolean): string {
	const lines = text.split('\n');
	const open: { indent: number; next: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^( *)(\d+)\. (.*)$/.exec(lines[i] ?? '');
		if (!m) {
			const other = /^( *)\S/.exec(lines[i] ?? '');
			const indent = other ? (other[1] ?? '').length : 0;
			// A bullet or a plain line closes every list at its own indent or deeper.
			while (open.length > 0 && open[open.length - 1]!.indent >= indent) open.pop();
			continue;
		}
		const indent = (m[1] ?? '').length;
		while (open.length > 0 && open[open.length - 1]!.indent > indent) open.pop();
		let list = open[open.length - 1];
		if (!list || list.indent < indent) {
			list = { indent, next: fromFirst ? Number.parseInt(m[2] ?? '1', 10) : 1 };
			open.push(list);
		}
		lines[i] = `${m[1] ?? ''}${list.next}. ${m[3] ?? ''}`;
		list.next++;
	}
	return lines.join('\n');
}
