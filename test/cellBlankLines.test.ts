import { describe, it, expect } from 'vitest';
import { blankLinesBetweenBlocks, blockCount } from '../src/cellBlankLines';

describe('blankLinesBetweenBlocks', () => {
	it('is empty for a cell with no blank line', () => {
		expect(blankLinesBetweenBlocks('a\nb')).toEqual([]);
	});
	it('counts one blank line, which paragraphs without a margin do not show', () => {
		expect(blankLinesBetweenBlocks('a\n\nb')).toEqual([1]);
	});
	it('counts every blank line of a run', () => {
		expect(blankLinesBetweenBlocks('a\n\n\nb')).toEqual([2]);
		expect(blankLinesBetweenBlocks('a\n\n\n\n\nb')).toEqual([4]);
	});
	it('keeps the order of several gaps', () => {
		expect(blankLinesBetweenBlocks('a\n\nb\n\n\n\nc')).toEqual([1, 3]);
	});
	it('ignores blank lines at either end, which show nothing', () => {
		expect(blankLinesBetweenBlocks('\n\na\n\nb\n\n')).toEqual([1]);
	});
	it('treats a line of spaces as blank', () => {
		expect(blankLinesBetweenBlocks('a\n  \n\t\nb')).toEqual([2]);
	});
	it('reads Windows line ends', () => {
		expect(blankLinesBetweenBlocks('a\r\n\r\n\r\nb')).toEqual([2]);
	});
	it('gives up on a code fence, whose inner blank lines are code', () => {
		expect(blankLinesBetweenBlocks('a\n\n```\nx\n\n\ny\n```')).toBeNull();
	});
});

describe('blockCount', () => {
	it('is the number of paragraphs', () => {
		expect(blockCount('a\n\n\nb\n\nc')).toBe(3);
		expect(blockCount('a\nb')).toBe(1);
	});
	it('is zero for empty text and for a text it cannot read', () => {
		expect(blockCount('  \n ')).toBe(0);
		expect(blockCount('```\nx\n```')).toBe(0);
	});
});
