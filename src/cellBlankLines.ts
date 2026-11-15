/**
 * Blank lines in a cell's text. Markdown turns any run of them into one paragraph break and the cell's paragraphs have
 * no margin, so `a`, two blank lines and `b` came out as two lines. The cell shows every line it was typed with.
 */

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * For each gap between the cell's top-level blocks, how many blank lines it holds. Paragraphs have no margin, so all of
 * them are lost, the first included. Null when the text has anything the gaps could not be matched to blocks for, such
 * as a code fence: the cell is then left as Markdown draws it.
 */
export function blankLinesBetweenBlocks(text: string): number[] | null {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	let first = 0;
	while (first < lines.length && (lines[first] ?? '').trim() === '') first++;
	let last = lines.length - 1;
	while (last >= first && (lines[last] ?? '').trim() === '') last--;
	const gaps: number[] = [];
	let run = 0;
	let seenBlock = false;
	for (let i = first; i <= last; i++) {
		const line = lines[i] ?? '';
		if (FENCE.test(line)) return null;
		if (line.trim() === '') { run++; continue; }
		if (seenBlock && run > 0) gaps.push(run);
		seenBlock = true;
		run = 0;
	}
	return gaps;
}

/** The number of paragraphs the text is split into by its blank lines. */
export function blockCount(text: string): number {
	const gaps = blankLinesBetweenBlocks(text);
	if (gaps === null) return 0;
	return text.trim() === '' ? 0 : gaps.length + 1;
}
