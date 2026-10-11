import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../common/test-base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(__dirname, '../../common/shell.html');
const POLYFILL = path.join(__dirname, '../../common/obsidian-dom-polyfill.js');
const BUNDLE = path.join(__dirname, '../../common/real-bundle.generated.js');

// The settings tab's "default theme for new tables" dropdown, against the real
// BetterTableSettingTab: what it offers, what it starts at, and that a pick is saved.
test.describe('default theme setting', () => {
	type P = import('@playwright/test').Page;

	const openTab = async (page: P, defaultTheme?: string) => {
		await page.addInitScript({ path: POLYFILL });
		await page.goto(`file://${SHELL}`);
		await page.addScriptTag({ path: BUNDLE });
		await page.evaluate((initial) => {
			const R = window.RichTableReal;
			const settings = structuredClone(R.DEFAULT_SETTINGS);
			if (initial !== undefined) settings.defaultTheme = initial;
			const plugin = {
				app: {},
				settings,
				choiceRegistry: new R.ChoiceRegistry([]),
				saveSettings: async () => { window.__btSaved = (window.__btSaved ?? 0) + 1; },
			};
			window.__btPlugin = plugin;
			const tab = new R.BetterTableSettingTab({}, plugin);
			tab.containerEl = document.body.createDiv();
			tab.display();
		}, defaultTheme);
		return page.locator('.setting-item', { hasText: 'Default theme for new tables' }).locator('select');
	};

	test('offers "no theme" plus every built-in theme, and starts on grid', async ({ page }) => {
		const select = await openTab(page);
		await expect(select.locator('option')).toHaveText(['Default', 'Academic 📐', 'Grid 🔲', 'Plain 🙂']);
		expect(await select.inputValue()).toBe('grid');
	});

	test('choosing a theme saves it', async ({ page }) => {
		const select = await openTab(page);
		await select.selectOption('plain');
		expect(await page.evaluate(() => (window as unknown as { __btPlugin: { settings: { defaultTheme: string } } }).__btPlugin.settings.defaultTheme)).toBe('plain');
		expect(await page.evaluate(() => (window as unknown as { __btSaved?: number }).__btSaved)).toBe(1);
	});

	test('"Default" saves as no theme', async ({ page }) => {
		const select = await openTab(page, 'academic');
		expect(await select.inputValue()).toBe('academic');
		await select.selectOption('');
		expect(await page.evaluate(() => (window as unknown as { __btPlugin: { settings: { defaultTheme: string } } }).__btPlugin.settings.defaultTheme)).toBe('');
	});
});

// Inserting a blank table end to end: the real empty-block banner, the real grid
// picker, and the text that actually lands in the note.
test.describe('default theme on a new blank table', () => {
	const EMPTY = '```rich-table\n\n```\n';
	type P = import('@playwright/test').Page;

	const insertBlank = async (page: P) => {
		await page.locator('.bt-template-btn', { hasText: 'Insert blank table' }).hover();
		await page.locator('.bt-gp-cell').first().click();
	};

	test('uses the configured theme', async ({ renderBlock, page }) => {
		const block = await renderBlock(EMPTY, { settings: { defaultTheme: 'academic' } });
		await insertBlank(page);
		await expect.poll(() => block.noteText()).toContain('theme: academic');
	});

	test('writes no theme when set to Default', async ({ renderBlock, page }) => {
		const block = await renderBlock(EMPTY, { settings: { defaultTheme: '' } });
		await insertBlank(page);
		await expect.poll(() => block.noteText()).toContain('version: 2');
		expect(await block.noteText()).not.toContain('theme:');
	});

	test('ignores a theme id that no longer exists', async ({ renderBlock, page }) => {
		const block = await renderBlock(EMPTY, { settings: { defaultTheme: 'removed-theme' } });
		await insertBlank(page);
		await expect.poll(() => block.noteText()).toContain('version: 2');
		expect(await block.noteText()).not.toContain('theme:');
	});
});
