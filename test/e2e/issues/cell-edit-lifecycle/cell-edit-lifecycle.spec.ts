import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Cell editing end-to-end, through the real renderer.
//
// The case worth the most here is the last one. A cell's editor saves on blur —
// but a blur also fires when the editor is REMOVED, which happens on every
// write-back rebuild, and saving then would persist a value the user never
// committed and clobber whatever the rebuild was carrying. The guard is an
// `isConnected` check, and it has to be deferred by a microtask: the browser
// dispatches blur on a focused descendant as an intermediate step of removing it,
// BEFORE isConnected flips, so the same check made synchronously inside the blur
// handler always sees true. That was established empirically, took three rounds
// of diagnostic logging with the user, and had no test — because until the
// harness could run the real renderTable there was no way to write one.
test.describe('cell-edit-lifecycle', () => {
	const SOURCE = scrollableTable({ theme: 'grid' });
	const CELL = '.bt-td[data-row="1"][data-col="0"]';

	const ops = (page: import('@playwright/test').Page) =>
		page.evaluate(() => (window as unknown as { __btOps: { type: string; value?: string }[] }).__btOps);

	/** Single click enters edit in the default mode, after a short delay. */
	const startEditing = async (page: import('@playwright/test').Page) => {
		await page.locator(CELL).first().click();
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(1);
	};

	test('a single click enters edit mode and focuses the editor', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		expect(await page.evaluate(() => {
			const active = document.activeElement as HTMLElement | null;
			return !!active?.closest('.bt-editing') || (active?.classList.contains('bt-editing') ?? false);
		}), 'the editor was created but never focused, so typing would go nowhere').toBe(true);
	});

	test('committing an edit emits the change', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('edited');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await ops(page)).length).toBeGreaterThan(0);
		const committed = await ops(page);
		expect(JSON.stringify(committed)).toContain('edited');
	});

	test('Escape abandons the edit without emitting anything', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('discard me');
		await page.keyboard.press('Escape');
		await expect.poll(() => page.locator(`${CELL}.bt-editing`).count()).toBe(0);
		expect(JSON.stringify(await ops(page)),
			'Escape persisted the draft — cancel must not route through save').not.toContain('discard me');
	});

	test('an editor removed from the DOM does not save what was typed', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		await startEditing(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('never committed');

		// Exactly what a write-back rebuild does to a mid-edit cell: the focused
		// editor is removed, which fires blur. Saving on that blur would persist a
		// value the user never committed.
		await page.evaluate((sel) => {
			document.querySelector(`${sel}.bt-editing`)?.remove();
		}, CELL);
		// A microtask is all the guard needs, but wait longer so a late save would
		// still be caught rather than merely raced.
		await page.waitForTimeout(200);

		expect(JSON.stringify(await ops(page)),
			'removing the editor saved the uncommitted draft — the isConnected guard must be deferred, since blur fires before isConnected flips')
			.not.toContain('never committed');
	});

	test('a genuine blur still saves', async ({ page, renderFull }) => {
		// The mirror of the case above: the guard must reject only removal-driven
		// blurs, not real ones. Without this, "never save on blur" would pass the
		// test above while silently losing every click-away edit.
		await renderFull(SOURCE);
		await startEditing(page);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('click away');
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await expect.poll(async () => JSON.stringify(await ops(page))).toContain('click away');
	});
});
