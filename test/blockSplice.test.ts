import { describe, it, expect } from 'vitest';
import { spliceBlock } from '../src/blockSplice';

describe('spliceBlock', () => {
	it('replaces what is between the fences and nothing else', () => {
		expect(spliceBlock('a\n```x\nold\nolder\n```\nb', 1, 4, 'new\nnewer\n')).toBe('a\n```x\nnew\nnewer\n```\nb');
	});

	it('writes each line at the opening fence indent, and leaves blank lines blank', () => {
		expect(spliceBlock('- i\n  ```x\n  old\n  ```\n', 1, 3, 'a\n\nb')).toBe('- i\n  ```x\n  a\n\n  b\n  ```\n');
	});

	it('uses the line ending of the opening fence', () => {
		expect(spliceBlock('```x\r\nold\r\n```\r\n', 0, 2, 'a\nb')).toBe('```x\r\na\r\nb\r\n```\r\n');
	});

	it('leaves an empty block between the fences when the body is empty', () => {
		expect(spliceBlock('```x\nold\n```', 0, 2, '')).toBe('```x\n```');
	});
});
