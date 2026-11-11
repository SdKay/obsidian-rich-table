/**
 * Ticking a task that a cell renders. Obsidian draws the checkbox but only a note's own view writes the change back,
 * so the cell does it: the n-th task item of the rendered cell is the n-th task line of its Markdown.
 */

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\]\s)/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * The cell's text with the n-th task line (counting from 0, skipping code blocks) flipped: ticked if it was open,
 * open if it was ticked. Null when the cell has no such line. Only the mark between the brackets changes; the rest of
 * the line stays as it was. The mark is read from the text and not from the checkbox, which a theme or a plugin may
 * hide or replace.
 */
export function toggleTaskInCell(text: string, index: number): string | null {
	const lines = text.split('\n');
	let fence: string | null = null;
	let seen = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const f = FENCE.exec(line);
		if (f) {
			const mark = f[1] ?? '';
			if (fence === null) fence = mark;
			else if (mark.startsWith(fence.charAt(0)) && mark.length >= fence.length) fence = null;
			continue;
		}
		if (fence !== null) continue;
		const m = TASK_LINE.exec(line);
		if (!m) continue;
		if (seen++ !== index) continue;
		lines[i] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${line.slice(m[0].length)}`;
		return lines.join('\n');
	}
	return null;
}
