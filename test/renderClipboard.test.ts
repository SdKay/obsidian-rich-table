import { describe, it, expect } from 'vitest';
import { parseMarkdownPipeTable } from '../src/renderClipboard';

describe('parseMarkdownPipeTable', () => {
	it('parses a standard piped table with a header row', () => {
		const text = [
			'| a | b |',
			'| --- | --- |',
			'| 1 | 2 |',
			'| 3 | 4 |',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
		]);
	});

	it('parses a table without leading/trailing pipes', () => {
		const text = [
			'a | b',
			'--- | ---',
			'1 | 2',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a', 'b'],
			['1', '2'],
		]);
	});

	it('accepts alignment colons in the delimiter row', () => {
		const text = [
			'| a | b | c |',
			'| :-- | :-: | --: |',
			'| 1 | 2 | 3 |',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a', 'b', 'c'],
			['1', '2', '3'],
		]);
	});

	it('unescapes \\| and converts <br> back to a newline (round-trips copyRangeAsMarkdown output)', () => {
		const text = [
			'| a\\|b | line1<br>line2 |',
			'| --- | --- |',
		].join('\n');
		expect(parseMarkdownPipeTable(text)).toEqual([
			['a|b', 'line1\nline2'],
		]);
	});

	it('tolerates a header-only table with a trailing blank line', () => {
		const text = '| a | b |\n| --- | --- |\n';
		expect(parseMarkdownPipeTable(text)).toEqual([['a', 'b']]);
	});

	it('preserves a legitimately empty middle cell', () => {
		const text = '| a | | c |\n| --- | --- | --- |\n';
		expect(parseMarkdownPipeTable(text)).toEqual([['a', '', 'c']]);
	});

	it('returns null for plain multi-line prose', () => {
		expect(parseMarkdownPipeTable('just some text\nacross two lines')).toBeNull();
	});

	it('returns null for a single line, even one with pipes', () => {
		expect(parseMarkdownPipeTable('| a | b |')).toBeNull();
	});

	it('returns null for a Setext-style heading underline (no pipes at all)', () => {
		// A bare "---" line matches the delimiter-row dash pattern on its own —
		// the whole point of requiring a pipe in BOTH lines is to reject this.
		expect(parseMarkdownPipeTable('My Heading\n---\nSome paragraph text.')).toBeNull();
	});

	it('returns null when the second line is not a real delimiter row', () => {
		expect(parseMarkdownPipeTable('| a | b |\n| 1 | 2 |')).toBeNull();
	});
});
