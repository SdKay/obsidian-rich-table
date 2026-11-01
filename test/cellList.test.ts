import { describe, it, expect } from 'vitest';
import { backspaceInList, bulletMarker, continueList, nextMarker, parseListItem, renumberLists } from '../src/cellList';

describe('bulletMarker', () => {
	it('changes with the depth and starts over after the last', () => {
		expect([0, 1, 2, 3, 4].map(bulletMarker)).toEqual(['•', '◦', '▪', '•', '◦']);
	});
});

describe('parseListItem', () => {
	it('reads indent, marker and content', () => {
		expect(parseListItem('  - c')).toEqual({ indent: '  ', marker: '-', ordered: false, content: 'c' });
		expect(parseListItem('10. ten')).toEqual({ indent: '', marker: '10.', ordered: true, content: 'ten' });
	});
	it('is null for anything else', () => {
		for (const l of ['plain', '-no space', '5.five', 'a - b', '']) expect(parseListItem(l)).toBeNull();
	});
});

describe('continueList', () => {
	it('repeats a bullet on the same level', () => {
		expect(continueList('- a')).toBe('- ');
		expect(continueList('    * a')).toBe('    * ');
	});
	it('goes up by one for a number, whatever it started at', () => {
		expect(continueList('5. five')).toBe('6. ');
		expect(continueList('   9. x')).toBe('   10. ');
	});
	it('is null for a line that is not a list item', () => {
		expect(continueList('plain')).toBeNull();
	});
});

describe('nextMarker', () => {
	it('keeps the bullet that was used', () => {
		expect(nextMarker(parseListItem('+ a')!)).toBe('+');
	});
});

describe('backspaceInList', () => {
	it('takes the space after an empty marker, then the marker', () => {
		expect(backspaceInList('  - ', ['2. b'])).toEqual({ replaceWith: '  -' });
		expect(backspaceInList('  -', ['2. b'])).toEqual({ replaceWith: '  ' });
		expect(backspaceInList('3. ', [])).toEqual({ replaceWith: '3.' });
	});
	it('goes up one level from a line of indent only, with that level\'s next marker', () => {
		expect(backspaceInList('   ', ['1. a', '2. b', '   - c'])).toEqual({ replaceWith: '3. ' });
	});
	it('picks the nearest line that is less indented', () => {
		expect(backspaceInList('    ', ['- a', '  - b', '    - c'])).toEqual({ replaceWith: '  - ' });
	});
	it('stays out of the way when there is nothing above to go up to', () => {
		expect(backspaceInList('  ', ['plain'])).toBeNull();
		expect(backspaceInList('  ', [])).toBeNull();
	});
	it('does nothing on a line with content', () => {
		expect(backspaceInList('  - c', ['2. b'])).toBeNull();
		expect(backspaceInList('x', [])).toBeNull();
	});
});

describe('renumberLists', () => {
	it('numbers from 1 by default', () => {
		expect(renumberLists('3. a\n7. b\n1. c', false)).toBe('1. a\n2. b\n3. c');
	});
	it('numbers from the first item when asked to', () => {
		expect(renumberLists('3. a\n7. b\n1. c', true)).toBe('3. a\n4. b\n5. c');
	});
	it('leaves a text without a numbered list as it is', () => {
		expect(renumberLists('plain\n- a\n- b', true)).toBe('plain\n- a\n- b');
		expect(renumberLists('', false)).toBe('');
	});
	it('gives a deeper list its own numbers', () => {
		expect(renumberLists('1. a\n   5. x\n   9. y\n4. b', false)).toBe('1. a\n   1. x\n   2. y\n2. b');
		expect(renumberLists('1. a\n   5. x\n   9. y\n4. b', true)).toBe('1. a\n   5. x\n   6. y\n2. b');
	});
	it('starts a new list after a bullet or a plain line', () => {
		expect(renumberLists('4. a\n- b\n9. c', true)).toBe('4. a\n- b\n9. c');
		expect(renumberLists('4. a\nplain\n9. c\n9. d', true)).toBe('4. a\nplain\n9. c\n10. d');
	});
	it('does not touch what is after the marker', () => {
		expect(renumberLists('2. 3. four\n9. **b**', false)).toBe('1. 3. four\n2. **b**');
	});
});
