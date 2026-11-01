import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// A list in a cell keeps its levels: two spaces make a level, and each level is pushed in. An ordered
// list can count on from the number it is written with, and a line break while editing carries it on.
const sourceWith = (cell: string) => `---
version: 2
columns:
  - { id: c_0, name: A, width: 220 }
rows:
  - id: r_0
    cells:
      c_0: ${JSON.stringify(cell)}
---
`;
const CELL = 'td[data-row="1"][data-col="0"]';
const anyNumber = (page: Page, on: boolean) => page.evaluate(v => (window as unknown as { RichTableReal: { setListStartAnyNumber(on: boolean): void } }).RichTableReal.setListStartAnyNumber(v), on);
const markers = (page: Page) => page.locator(`${CELL} .bt-list-marker`).evaluateAll(els => els.map(e => ({
	text: e.textContent, depth: (e as HTMLElement).style.getPropertyValue('--bt-list-depth'), left: e.getBoundingClientRect().left, top: e.getBoundingClientRect().top,
})));
const lines = (page: Page) => page.locator(`${CELL} .bt-list-block`).innerText();

test('items nested by two spaces are shown one level in, each with its own marker', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(sourceWith('- a\n  - b\n    - c\n- d'));
	const m = await markers(page);
	expect(m.map(x => x.text)).toEqual(['• ', '◦ ', '▪ ', '• ']);
	expect(m.map(x => x.depth)).toEqual(['', '1', '2', '']);
	expect(m[1]!.left, 'level 1 sits in from level 0').toBeGreaterThan(m[0]!.left + 8);
	expect(m[2]!.left, 'level 2 sits in from level 1').toBeGreaterThan(m[1]!.left + 8);
	expect(m[3]!.left).toBeCloseTo(m[0]!.left, 0);
	expect(await lines(page)).toContain('b');
});

test('two spaces under a numbered item are not enough to nest, and the two lists stay on separate lines', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(sourceWith('2. b\n  - c'));
	const m = await markers(page);
	expect(m.map(x => x.text)).toEqual(['1. ', '• ']);
	expect(m[1]!.depth, 'a list of its own, not a level inside the first').toBe('');
	expect(m[1]!.top, 'the second list starts below the first').toBeGreaterThan(m[0]!.top + 4);
});

test('lists that follow one another are not set side by side on one line', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(sourceWith('1. a\n- b'));
	const tops = await page.locator(`${CELL} .bt-list-marker`).evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
	expect(tops[1]!, 'the second list starts below the first').toBeGreaterThan(tops[0]! + 4);
});

test('an ordered list under an ordered list counts its own items from 1', async ({ page, renderFull }) => {
	await renderFull(sourceWith('1. a\n   1. x\n   2. y\n2. b'));
	expect((await markers(page)).map(x => x.text)).toEqual(['1. ', '1. ', '2. ', '2. ']);
});

test('an ordered list starts at 1 by default, whatever number it is written with', async ({ page, renderFull }) => {
	await renderFull(sourceWith('3. a\n4. b'));
	expect((await markers(page)).map(x => x.text)).toEqual(['1. ', '2. ']);
});

test('with the setting on it counts on from the number its first line is written with', async ({ page, renderBlock }) => {
	const block = await renderBlock(sourceWith('3. a\n4. b'));
	await expect.poll(async () => (await markers(page)).map(x => x.text)).toEqual(['1. ', '2. ']);
	await anyNumber(page, true);
	await block.changeSettingsAndRefresh({});
	await expect.poll(async () => (await markers(page)).map(x => x.text)).toEqual(['3. ', '4. ']);
});

const startEditing = async (page: Page) => {
	await page.locator(CELL).click();
	await page.locator(`${CELL} .bt-cell-editor`).waitFor();
	await page.keyboard.press('Control+a');
};
const editorText = (page: Page) => page.locator(`${CELL} .bt-cell-editor`).evaluate(e => e.textContent);

const editAt = async (page: Page, text: string) => {
	await page.locator(CELL).click();
	await page.locator(`${CELL} .bt-cell-editor`).waitFor();
	await page.keyboard.press('Control+a');
	await page.keyboard.type('x'); // replaces the cell's text, then the real text is set below
	await page.locator(`${CELL} .bt-cell-editor`).evaluate((e, t) => {
		e.textContent = t;
		const r = document.createRange();
		r.selectNodeContents(e);
		r.collapse(false);
		const s = getSelection()!;
		s.removeAllRanges();
		s.addRange(r);
	}, text);
};

test.describe('a line break while editing a list', () => {
	test('starts the next item on the same level, with its marker', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await editAt(page, '2. b\n   - c');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('d');
		expect(await editorText(page)).toBe('2. b\n   - c\n   - d');
	});

	test('counts a numbered list on from the number it is at, and keeps the indent', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await editAt(page, '5. five\n   9. x');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('y');
		await page.keyboard.press('Shift+Enter');
		expect(await editorText(page)).toBe('5. five\n   9. x\n   10. y\n   11. ');
	});

	test('does nothing on a line that is not an item', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await editAt(page, 'plain');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('next');
		expect(await editorText(page)).toBe('plain\nnext');
	});
});

test.describe('Backspace on an empty list item', () => {
	test('takes the space, then the marker, then goes up a level with that level\'s next number', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await editAt(page, '1. a\n2. b\n   - c');
		await page.keyboard.press('Shift+Enter');
		expect(await editorText(page)).toBe('1. a\n2. b\n   - c\n   - ');
		await page.keyboard.press('Backspace');
		expect(await editorText(page)).toBe('1. a\n2. b\n   - c\n   -');
		await page.keyboard.press('Backspace');
		expect(await editorText(page)).toBe('1. a\n2. b\n   - c\n   ');
		await page.keyboard.press('Backspace');
		expect(await editorText(page)).toBe('1. a\n2. b\n   - c\n3. ');
	});

	test('leaves Backspace alone on an item that has text', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await editAt(page, '- ab');
		await page.keyboard.press('Backspace');
		expect(await editorText(page)).toBe('- a');
	});

	test('leaves Backspace alone outside a list', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await editAt(page, 'plain  ');
		await page.keyboard.press('Backspace');
		expect(await editorText(page)).toBe('plain ');
	});
});

test.describe('what is stored after editing agrees with what is shown', () => {
	const sentValue = async (page: Page) => {
		const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string; value?: string }[] }).__btOps);
		return ops.filter(o => o.type === 'set-cell-content').map(o => o.value);
	};
	const commit = async (page: Page, text: string) => {
		await editAt(page, text);
		await page.keyboard.press('Enter');
	};

	test('numbers go from 1 when the setting is off', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await anyNumber(page, false);
		await commit(page, '3. a\n7. b\n1. c');
		expect(await sentValue(page)).toEqual(['1. a\n2. b\n3. c']);
	});

	test('numbers go on from the first one when the setting is on', async ({ page, renderFull }) => {
		await renderFull(sourceWith('x'));
		await anyNumber(page, true);
		await commit(page, '3. a\n7. b\n1. c');
		expect(await sentValue(page)).toEqual(['3. a\n4. b\n5. c']);
	});

	test('a cell opened and closed without a change is not rewritten', async ({ page, renderFull }) => {
		await renderFull(sourceWith('3. a\n7. b'));
		await anyNumber(page, false);
		await page.locator(CELL).click();
		await page.locator(`${CELL} .bt-cell-editor`).waitFor();
		await page.keyboard.press('Enter');
		expect(await sentValue(page)).toEqual([]);
	});
});
