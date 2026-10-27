import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../common/test-base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(__dirname, '../../common/shell.html');
const POLYFILL = path.join(__dirname, '../../common/obsidian-dom-polyfill.js');
const BUNDLE = path.join(__dirname, '../../common/real-bundle.generated.js');

// The "Cell padding" row of the settings tab, against the real BetterTableSettingTab.
type P = import('@playwright/test').Page;

const openTab = async (page: P, stored?: number) => {
	await page.addInitScript({ path: POLYFILL });
	await page.goto(`file://${SHELL}`);
	await page.addScriptTag({ path: BUNDLE });
	await page.evaluate((stored) => {
		const R = window.RichTableReal;
		const settings = structuredClone(R.DEFAULT_SETTINGS);
		if (stored !== undefined) settings.cellPaddingY = stored;
		const w = window as unknown as Record<string, unknown>;
		const plugin = {
			app: {}, settings,
			choiceRegistry: new R.ChoiceRegistry([]),
			xlsxViewRefused: false, xlsxViewNeedsReload: false,
			saveSettings: async () => {
				w.__btSaved = ((w.__btSaved as number) ?? 0) + 1;
				R.applyCellPadding(settings.cellPaddingY);
			},
		};
		w.__btPlugin = plugin;
		const tab = new R.BetterTableSettingTab({}, plugin);
		tab.containerEl = document.body.createDiv();
		tab.display();
	}, stored);
	return page.locator('.setting-item', { hasText: 'Cell padding' }).locator('input[type="range"]');
};

const setSlider = (slider: import('@playwright/test').Locator, value: number) =>
	slider.evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const saved = (page: P) => page.evaluate(() => (window as unknown as { __btPlugin: { settings: { cellPaddingY: number } } }).__btPlugin.settings.cellPaddingY);
const published = (page: P) => page.evaluate(() => document.body.style.getPropertyValue('--bt-cell-pad-y'));

test('the slider starts at the default, 4', async ({ page }) => {
	const slider = await openTab(page);
	await expect(slider).toHaveValue('4');
	expect(await saved(page)).toBe(4);
});

test('the slider shows the stored value', async ({ page }) => {
	const slider = await openTab(page, 9);
	await expect(slider).toHaveValue('9');
});

test('the slider runs from 0 to 16 in steps of 1', async ({ page }) => {
	const slider = await openTab(page);
	await expect(slider).toHaveAttribute('min', '0');
	await expect(slider).toHaveAttribute('max', '16');
	await expect(slider).toHaveAttribute('step', '1');
});

test('moving the slider saves the value and publishes it to the cells at once', async ({ page }) => {
	const slider = await openTab(page);
	await setSlider(slider, 11);
	expect(await saved(page)).toBe(11);
	expect(await page.evaluate(() => (window as unknown as { __btSaved?: number }).__btSaved)).toBe(1);
	expect(await published(page)).toBe('11px');
});
