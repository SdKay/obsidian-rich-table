import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../common/test-base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(__dirname, '../../common/shell.html');
const POLYFILL = path.join(__dirname, '../../common/obsidian-dom-polyfill.js');
const BUNDLE = path.join(__dirname, '../../common/real-bundle.generated.js');

// The "Open .xlsx files in Rich Table" row of the settings tab, against the real BetterTableSettingTab.
test.describe('open .xlsx files setting', () => {
	type P = import('@playwright/test').Page;
	interface State { own?: boolean; refused?: boolean; needsReload?: boolean }

	const openTab = async (page: P, state: State = {}) => {
		await page.addInitScript({ path: POLYFILL });
		await page.goto(`file://${SHELL}`);
		await page.addScriptTag({ path: BUNDLE });
		await page.evaluate((state) => {
			const R = window.RichTableReal;
			const settings = structuredClone(R.DEFAULT_SETTINGS);
			if (state.own !== undefined) settings.ownXlsxFiles = state.own;
			const w = window as unknown as Record<string, unknown>;
			const plugin = {
				app: {}, settings,
				choiceRegistry: new R.ChoiceRegistry([]),
				xlsxViewRefused: !!state.refused,
				xlsxViewNeedsReload: !!state.needsReload,
				saveSettings: async () => { w.__btSaved = ((w.__btSaved as number) ?? 0) + 1; },
			};
			w.__btPlugin = plugin;
			const tab = new R.BetterTableSettingTab({}, plugin);
			tab.containerEl = document.body.createDiv();
			tab.display();
		}, state);
		return page.locator('.setting-item', { hasText: 'Open .xlsx files in Rich Table' });
	};
	const toggleOf = (row: import('@playwright/test').Locator) => row.locator('input[type="checkbox"], .checkbox-container');
	const own = (page: P) => page.evaluate(() => (window as unknown as { __btPlugin: { settings: { ownXlsxFiles: boolean } } }).__btPlugin.settings.ownXlsxFiles);
	const warning = (row: import('@playwright/test').Locator) => row.locator('.mod-warning');

	test('is on by default', async ({ page }) => {
		const row = await openTab(page);
		await expect(row).toBeVisible();
		expect(await own(page)).toBe(true);
	});

	test('switching it off saves the choice', async ({ page }) => {
		const row = await openTab(page);
		await toggleOf(row).first().click();
		expect(await own(page)).toBe(false);
		expect(await page.evaluate(() => (window as unknown as { __btSaved?: number }).__btSaved)).toBe(1);
	});

	test('shows no warning when nothing is wrong', async ({ page }) => {
		const row = await openTab(page);
		await expect(warning(row)).toBeHidden();
	});

	test('says so when another plugin already owns .xlsx and this one is meant to', async ({ page }) => {
		const row = await openTab(page, { refused: true });
		await expect(warning(row)).toBeVisible();
		await expect(warning(row)).toContainText('Another plugin already opens .xlsx files');
	});

	test('does not complain about a refusal once the setting is off', async ({ page }) => {
		const row = await openTab(page, { own: false, refused: true });
		await expect(warning(row)).toBeHidden();
	});

	test('the refusal warning goes away when the setting is switched off', async ({ page }) => {
		const row = await openTab(page, { refused: true });
		await expect(warning(row)).toBeVisible();
		await toggleOf(row).first().click();
		await expect(warning(row)).toBeHidden();
	});

	test('says a reload is needed when turning it off could not be done on the spot', async ({ page }) => {
		const row = await openTab(page, { own: false, needsReload: true });
		await expect(warning(row)).toBeVisible();
		await expect(warning(row)).toContainText('reload');
	});

	test('does not ask for a reload while the setting is on', async ({ page }) => {
		const row = await openTab(page, { own: true, needsReload: true });
		await expect(warning(row)).toBeHidden();
	});
});
