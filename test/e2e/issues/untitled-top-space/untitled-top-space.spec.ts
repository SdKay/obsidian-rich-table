import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// With no title, the space between the view's top edge and the body is just the
// column-selector strip (22px when editable, none when locked).
const top = async (page: import('@playwright/test').Page) => {
	const frame = (await page.locator('.bt-outer-frame').boundingBox())!;
	const body = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	return Math.round(body.y - frame.y);
};

test('an editable untitled table has only the selector strip above the body', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] }));
	expect(await top(page)).toBe(22);
});

test('a locked untitled table has no space above the body', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], locked: true }));
	expect(await top(page)).toBeLessThanOrEqual(2);
});

test('a titled table is unaffected', async ({ page, renderFull }) => {
	await renderFull(tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], title: 'T' } as never));
	const body = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	const title = (await page.locator('.bt-table-title').boundingBox())!;
	expect(body.y).toBeGreaterThan(title.y + title.height - 1);
});
