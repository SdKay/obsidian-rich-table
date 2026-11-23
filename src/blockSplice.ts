/**
 * Replaces the lines between a code block's fences with `body`, leaving every other line as it is.
 * `body` is written at the opening fence's indent, as a block under a list item needs, and with the
 * note's own line ending.
 */
export function spliceBlock(content: string, lineStart: number, lineEnd: number, body: string): string {
	const lines = content.split('\n');
	const fence = lines[lineStart] ?? '';
	const indent = /^[ \t]*/.exec(fence)![0];
	const eol = fence.endsWith('\r') ? '\r' : '';
	const bodyLines = body.trimEnd() === '' ? [] : body.trimEnd().split('\n').map(l => (l === '' ? l : indent + l) + eol);
	return [...lines.slice(0, lineStart + 1), ...bodyLines, ...lines.slice(lineEnd)].join('\n');
}
