import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

/**
 * A cell shows every line it was typed with. Markdown folds a run of blank lines into one paragraph break, and the
 * cell's paragraphs have no margin, so blank lines used to vanish.
 */

const cellText = (text: string) => `"${text}"`;

async function cellHeights(page: import('@playwright/test').Page, renderBlock: (s: string) => Promise<unknown>, texts: string[]): Promise<number[]> {
	const heights: number[] = [];
	for (const text of texts) {
		await renderBlock(tableSource({ widths: [200], rows: [{ 0: cellText(text) }] }));
		heights.push(await page.evaluate(() => document.querySelector<HTMLElement>('tbody td')!.getBoundingClientRect().height));
	}
	return heights;
}

test.describe('blank lines in a cell', () => {
	test('each blank line takes a line of its own @geometry', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		const [one, two, three, four] = await cellHeights(page, renderBlock, ['a\\nb', 'a\\n\\nb', 'a\\n\\n\\nb', 'a\\n\\n\\n\\nb']);
		const step = two! - one!;
		expect(step).toBeGreaterThan(10);
		expect(three! - two!).toBeCloseTo(step, 0);
		expect(four! - three!).toBeCloseTo(step, 0);
	});

	test('blank lines at either end of the text show nothing', async ({ page, renderBlock }) => {
		const [plain, padded] = await cellHeights(page, renderBlock, ['a\\nb', '\\n\\na\\nb\\n\\n']);
		expect(padded).toBe(plain);
	});
});
