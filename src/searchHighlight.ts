/** Half-open range in UTF-16 code units of an element's textContent. */
export interface TextSpan {
	start: number;
	end: number;
}

export const SEARCH_HIT_CLASS = 'bt-search-hit';
/** The one match the user opened from the results, drawn at full strength; the others are dimmed. */
export const SEARCH_HIT_ACTIVE_CLASS = 'bt-search-hit-active';

const SKIP = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA']);

/** The text nodes of a cell. A table nested in the cell is its own block, which marks itself, so it is not entered. */
function textNodes(root: Node): Text[] {
	const out: Text[] = [];
	const walk = (node: Node): void => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) out.push(child as Text);
			else if (child.nodeType === Node.ELEMENT_NODE) {
				const el = child as Element;
				if (!SKIP.has(el.tagName) && !el.classList.contains('bt-render-root')) walk(el);
			}
		}
	};
	walk(root);
	return out;
}

/** The text `markSpans` counts offsets in, which is what to match against. */
export function markableText(root: HTMLElement): string {
	return textNodes(root).map(n => n.data).join('');
}

/**
 * Wraps the given ranges of `root`'s text in `<mark class="bt-search-hit">`, node by node, so links,
 * emphasis and every other element of the rendered cell stay as they are. Returns a function that puts the
 * original nodes back. A mark of the reader's own (`==text==`) is a plain `<mark>` without the class and is never touched.
 */
export interface Marked {
	/** Puts the marks back as they were. */
	(): void;
	/** Draws the first mark of this text at full strength (or dimmed again); no other mark of it is ever bright. */
	setActive(on: boolean): void;
}

export function markSpans(root: HTMLElement, spans: readonly TextSpan[]): Marked {
	const marks: HTMLElement[] = [];
	const nodes = textNodes(root);
	// Sorted and merged, so one forward pass over the nodes is enough and no text is marked twice.
	const sorted: TextSpan[] = [];
	for (const s of spans.filter(x => x.end > x.start).sort((a, b) => a.start - b.start)) {
		const last = sorted[sorted.length - 1];
		if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
		else sorted.push({ start: s.start, end: s.end });
	}
	let offset = 0;
	for (const node of nodes) {
		const text = node.data;
		const nodeStart = offset;
		const nodeEnd = offset + text.length;
		offset = nodeEnd;
		const pieces: { from: number; to: number }[] = [];
		for (const s of sorted) {
			const from = Math.max(s.start, nodeStart) - nodeStart;
			const to = Math.min(s.end, nodeEnd) - nodeStart;
			if (to > from) pieces.push({ from, to });
		}
		if (pieces.length === 0) continue;
		const frag = createFragment();
		let cursor = 0;
		for (const { from, to } of pieces) {
			if (from > cursor) frag.appendChild(activeDocument.createTextNode(text.slice(cursor, from)));
			const mark = createEl('mark', { cls: SEARCH_HIT_CLASS, text: text.slice(from, to) });
			marks.push(mark);
			frag.appendChild(mark);
			cursor = to;
		}
		if (cursor < text.length) frag.appendChild(activeDocument.createTextNode(text.slice(cursor)));
		node.replaceWith(frag);
	}
	const undo = (): void => {
		const parents = new Set<Node>();
		for (const mark of marks) {
			const parent = mark.parentNode;
			if (!parent) continue;
			mark.replaceWith(activeDocument.createTextNode(mark.textContent ?? ''));
			parents.add(parent);
		}
		for (const parent of parents) parent.normalize();
		marks.length = 0;
	};
	return Object.assign(undo, {
		setActive(on: boolean): void {
			marks.forEach((mark, i) => mark.toggleClass(SEARCH_HIT_ACTIVE_CLASS, on && i === 0));
		},
	});
}

/**
 * Takes every search mark out of a cloned tree, for a snapshot that outlives the live marks. The live
 * page is untouched: this works on the clone it is given.
 */
export function stripSearchMarks(root: HTMLElement): void {
	const parents = new Set<Node>();
	root.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`).forEach(mark => {
		const parent = mark.parentNode;
		if (!parent) return;
		mark.replaceWith(activeDocument.createTextNode(mark.textContent ?? ''));
		parents.add(parent);
	});
	for (const parent of parents) parent.normalize();
}
