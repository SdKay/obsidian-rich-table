/** Half-open range in UTF-16 code units of an element's textContent. */
export interface TextSpan {
	start: number;
	end: number;
}

export const SEARCH_HIT_CLASS = 'bt-search-hit';

const SKIP = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA']);

function textNodes(root: Node): Text[] {
	const out: Text[] = [];
	const walk = (node: Node): void => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) out.push(child as Text);
			else if (child.nodeType === Node.ELEMENT_NODE && !SKIP.has((child as Element).tagName)) walk(child);
		}
	};
	walk(root);
	return out;
}

/**
 * Wraps the given ranges of `root`'s text in `<mark class="bt-search-hit">`, node by node, so links,
 * emphasis and every other element of the rendered cell stay as they are. Returns a function that puts the
 * original nodes back. A mark of the reader's own (`==text==`) is a plain `<mark>` without the class and is never touched.
 */
export function markSpans(root: HTMLElement, spans: readonly TextSpan[]): () => void {
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
	return () => {
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
}
