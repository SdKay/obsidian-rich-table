import { test, expect } from '../../common/test-base';

/**
 * Settings-driven left-toolbar button visibility (model.ts's
 * CtrlColButtonId/CTRL_COL_BUTTONS_BY_SCENARIO, settings.ts's "Left-toolbar
 * buttons" section). Covers the three scenarios end to end through the real
 * write-back layer (renderBlock), since the pure id/label-completeness data
 * is already covered at the unit level (test/ctrlColVisibility.test.ts) —
 * these tests are about tableBlock.ts actually threading the right hidden
 * set into renderTable() for each scenario.
 */
const NATIVE_UNLOCKED = `---
version: 2
columns:
  - { id: c_1, name: A }
rows:
  - { id: r_1, cells: { c_1: x } }
---
`;

const NATIVE_LOCKED = `---
version: 2
columns:
  - { id: c_1, name: A }
rows:
  - { id: r_1, cells: { c_1: x } }
locked: true
---
`;

test.describe('ctrlCol button visibility settings', () => {
	test('default settings (nothing hidden) show every button the scenario itself offers', async ({ page, renderBlock }) => {
		await renderBlock(NATIVE_UNLOCKED);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(1);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Snapshot"]')).toHaveCount(1);
	});

	test('hiding a button for the "unlocked" scenario removes it from an unlocked native table', async ({ page, renderBlock }) => {
		await renderBlock(NATIVE_UNLOCKED, {
			settings: { ctrlColHiddenButtons: { locked: [], unlocked: ['theme'], xlsxRef: [] } },
		});
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(0);
		// A DIFFERENT button in the same scenario is unaffected — hiding one id
		// must not accidentally suppress the whole column.
		await expect(page.locator('.bt-ctrl-btn[aria-label="Snapshot"]')).toHaveCount(1);
	});

	test('a button hidden only for "locked" still shows on an unlocked table', async ({ page, renderBlock }) => {
		await renderBlock(NATIVE_UNLOCKED, {
			settings: { ctrlColHiddenButtons: { locked: ['snapshot'], unlocked: [], xlsxRef: [] } },
		});
		await expect(page.locator('.bt-ctrl-btn[aria-label="Snapshot"]')).toHaveCount(1);
	});

	test('a button hidden only for "unlocked" still shows on a locked table', async ({ page, renderBlock }) => {
		await renderBlock(NATIVE_LOCKED, {
			settings: { ctrlColHiddenButtons: { locked: [], unlocked: ['snapshot'], xlsxRef: [] } },
		});
		await expect(page.locator('.bt-ctrl-btn[aria-label="Snapshot"]')).toHaveCount(1);
	});

	test('the lock button itself can be hidden, like any other button', async ({ page, renderBlock }) => {
		await renderBlock(NATIVE_UNLOCKED, {
			settings: { ctrlColHiddenButtons: { locked: [], unlocked: ['lock'], xlsxRef: [] } },
		});
		await expect(page.locator('.bt-ctrl-btn[aria-label="Lock table (disable graphical editing)"]')).toHaveCount(0);
	});

	test('hiding "snapshot" for the locked scenario removes it from a locked table, leaving lock/export in place', async ({ page, renderBlock }) => {
		await renderBlock(NATIVE_LOCKED, {
			settings: { ctrlColHiddenButtons: { locked: ['snapshot'], unlocked: [], xlsxRef: [] } },
		});
		await expect(page.locator('.bt-ctrl-btn[aria-label="Snapshot"]')).toHaveCount(0);
		await expect(page.locator('.bt-ctrl-btn.is-locked')).toHaveCount(1);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Export as .xlsx"]')).toHaveCount(1);
	});

	// Reported: changing this setting in the settings tab required a manual
	// re-render (reopening the note, or triggering some other write-back) to
	// actually take effect — the already-mounted table kept showing the OLD
	// button set. Fixed via tableBlock.ts's liveInstances registry +
	// refreshAllTableBlocks(), called from main.ts's saveSettings() the same
	// way it already force-rerenders Reading View. changeSettingsAndRefresh
	// (test-base.ts) reproduces exactly that call, on the SAME mounted
	// instance renderBlock() returned — no reprocess() in these tests.
	test('changing the setting on an already-mounted table updates its buttons immediately, with no reprocess/reopen', async ({ page, renderBlock }) => {
		const block = await renderBlock(NATIVE_UNLOCKED);
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(1);

		await block.changeSettingsAndRefresh({ ctrlColHiddenButtons: { locked: [], unlocked: ['theme'], xlsxRef: [] } });
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(0);
		// Unrelated button in the same scenario stays put through the live refresh.
		await expect(page.locator('.bt-ctrl-btn[aria-label="Snapshot"]')).toHaveCount(1);
	});

	test('re-showing a hidden button on the fly also takes effect immediately', async ({ page, renderBlock }) => {
		const block = await renderBlock(NATIVE_UNLOCKED, {
			settings: { ctrlColHiddenButtons: { locked: [], unlocked: ['theme'], xlsxRef: [] } },
		});
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(0);

		await block.changeSettingsAndRefresh({ ctrlColHiddenButtons: { locked: [], unlocked: [], xlsxRef: [] } });
		await expect(page.locator('.bt-ctrl-btn[aria-label="Change table theme"]')).toHaveCount(1);
	});
});
