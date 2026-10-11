import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// The UI follows Obsidian's language. These drive the real renderer with the
// language switched, and read the labels it actually produced.
test.describe('ui-language', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	type P = import('@playwright/test').Page;

	const themeMenuTitles = async (page: P) => {
		await page.locator('.bt-ctrl-btn[aria-label]').filter({ has: page.locator('svg') }).nth(0).hover();
		return page.evaluate(() => {
			const btn = [...document.querySelectorAll<HTMLElement>('.bt-ctrl-btn')].find(b => b.getAttribute('aria-label')?.match(/theme|テーマ|Design|thème|테마|主题/i));
			btn?.click();
			return window.RichTableReal.ShimMenu.opened.at(-1)?.items.map(i => i.title) ?? [];
		});
	};

	/** Sets Obsidian's language for every page load this test makes. */
	const useLanguage = (page: P, code: string) =>
		page.addInitScript(c => { (globalThis as { __btLang?: string }).__btLang = c; }, code);

	test('English is the default', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		expect(await themeMenuTitles(page)).toEqual(['Default', 'Academic 📐', 'Grid 🔲', 'Plain 🙂']);
	});

	test('Chinese keeps its theme names', async ({ page, renderFull }) => {
		await useLanguage(page, 'zh');
		await renderFull(SOURCE);
		expect(await themeMenuTitles(page)).toEqual(['默认', '学术 📐', '网格 🔲', '朴素 🙂']);
	});

	test('Japanese translates the UI but themes fall back to English', async ({ page, renderFull }) => {
		await useLanguage(page, 'ja');
		await renderFull(SOURCE);
		expect(await themeMenuTitles(page)).toEqual(['デフォルト', 'Academic 📐', 'Grid 🔲', 'Plain 🙂']);
	});

	test('an unsupported language falls back to English everywhere', async ({ page, renderFull }) => {
		await useLanguage(page, 'ru');
		await renderFull(SOURCE);
		expect(await themeMenuTitles(page)).toEqual(['Default', 'Academic 📐', 'Grid 🔲', 'Plain 🙂']);
	});
});
