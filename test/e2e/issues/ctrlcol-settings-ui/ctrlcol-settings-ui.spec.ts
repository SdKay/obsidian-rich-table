import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../common/test-base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(__dirname, '../../common/shell.html');
const POLYFILL = path.join(__dirname, '../../common/obsidian-dom-polyfill.js');
const BUNDLE = path.join(__dirname, '../../common/real-bundle.generated.js');

/**
 * The settings tab's "Left-toolbar buttons" section (settings.ts) — reworked
 * from one full-width Setting row per button into a dense icon+label+checkbox
 * chip grid, several per row, after that section grew to 12 rows for the
 * "unlocked" scenario alone. This exercises the REAL BetterTableSettingTab
 * against the real obsidian-shim.ts DOM, not a hand-port — the hide-on-toggle
 * *behaviour* itself is already covered against the real write-back layer in
 * test/e2e/issues/ctrl-col-visibility/; this spec is about the settings UI's
 * own shape (icon present, compact layout, toggle reflects/updates state).
 */
test.describe('ctrlCol settings tab — compact chip layout', () => {
	test('every chip in the "unlocked" group shows an icon, a label, and a checkbox', async ({ page }) => {
		await page.addInitScript({ path: POLYFILL });
		await page.goto(`file://${SHELL}`);
		await page.addScriptTag({ path: BUNDLE });

		await page.evaluate(() => {
			const R = window.RichTableReal;
			const plugin = {
				app: {},
				settings: structuredClone(R.DEFAULT_SETTINGS),
				choiceRegistry: new R.ChoiceRegistry([]),
				saveSettings: async () => { /* not exercised in this test */ },
			};
			const tab = new R.BetterTableSettingTab({}, plugin);
			tab.containerEl = document.body.createDiv();
			tab.display();
		});

		// `.filter({ hasText })` is a case-insensitive SUBSTRING match — the
		// section's own intro heading's description text also contains the
		// lowercase phrase "an unlocked table", so a substring filter matches
		// both that heading and the "Unlocked table" scenario heading itself.
		// getByText's exact:true option is a full-text match, which the section
		// intro's multi-sentence description can't accidentally satisfy.
		const unlockedHeading = page.locator('.setting-item-heading').getByText('Unlocked table', { exact: true });
		await expect(unlockedHeading).toHaveCount(1);

		const grid = page.locator('.bt-ctrlcol-grid').nth(1); // locked, then unlocked, then xlsxRef
		const chips = grid.locator('.bt-ctrlcol-chip');
		await expect(chips).toHaveCount(12); // CTRL_COL_BUTTONS_BY_SCENARIO.unlocked.length

		const firstChip = chips.first();
		await expect(firstChip.locator('.bt-ctrlcol-chip-icon svg')).toHaveCount(1);
		await expect(firstChip.locator('.bt-ctrlcol-chip-label')).not.toHaveText('');
		await expect(firstChip.locator('input[type="checkbox"]')).toHaveCount(1);
	});

	test('a chip\'s checkbox reflects the current setting, and toggling it saves the change', async ({ page }) => {
		await page.addInitScript({ path: POLYFILL });
		await page.goto(`file://${SHELL}`);
		await page.addScriptTag({ path: BUNDLE });

		await page.evaluate(() => {
			const R = window.RichTableReal;
			const settings = structuredClone(R.DEFAULT_SETTINGS);
			settings.ctrlColHiddenButtons.unlocked = ['theme'];
			const plugin = {
				app: {},
				settings,
				choiceRegistry: new R.ChoiceRegistry([]),
				saveSettings: async () => {
					window.__btSaved = (window.__btSaved ?? 0) + 1;
				},
			};
			const tab = new R.BetterTableSettingTab({}, plugin);
			tab.containerEl = document.body.createDiv();
			tab.display();
			window.__btPlugin = plugin;
		});

		const themeChip = page.locator('.bt-ctrlcol-chip').filter({ hasText: 'Change theme' });
		const checkbox = themeChip.locator('input[type="checkbox"]');
		// Starts unchecked — "theme" is in ctrlColHiddenButtons.unlocked above.
		await expect(checkbox).not.toBeChecked();

		await checkbox.check();
		expect(await page.evaluate(() => window.__btSaved)).toBe(1);
		const hidden = await page.evaluate(() => window.__btPlugin.settings.ctrlColHiddenButtons.unlocked);
		expect(hidden).not.toContain('theme');
	});
});
