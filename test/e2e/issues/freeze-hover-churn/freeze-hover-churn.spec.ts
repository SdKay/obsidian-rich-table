import { test, expect } from '../../common/test-base';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The real user table (30 columns, freeze 3x3, a merge, grid theme) — the churn
// this guards against scales with column count, so a toy fixture would hide it.
const SOURCE = fs.readFileSync(path.join(__dirname, '../freeze-merge-corruption/source.yaml'), 'utf8');

// applyFreeze runs from a ResizeObserver on the table and used to rewrite every
// inline style on every frozen cell on every pass — measured at hundreds of style
// mutations on a SINGLE cell just from moving the pointer across the table. Each
// write is a style recalc, and a write that anything observing the table can see
// is exactly what a ResizeObserver feedback loop runs on; this codebase has
// already had one such loop pin Obsidian's main thread.
//
// It went unnoticed because nothing could measure it: these tests need the REAL
// renderTable (hover strips, resize handles, the observers that drive them),
// which only became runnable in the harness once obsidian-shim.ts gave the
// types-only `obsidian` package a runtime.
test.describe('freeze-hover-churn', () => {
	/** Style mutations on one frozen cell, counted from before the first hover. */
	const countWrites = async (page: import('@playwright/test').Page): Promise<() => Promise<number>> => {
		const cellFound = await page.evaluate(() => {
			const w = window as unknown as { __btWrites: number };
			w.__btWrites = 0;
			const cell = document.querySelector('.bt-frozen-col');
			if (cell) {
				new MutationObserver(ms => { w.__btWrites += ms.length; })
					.observe(cell, { attributes: true, attributeFilter: ['style'] });
			}
			return cell !== null;
		});
		expect(cellFound, 'no frozen cell was found to observe, so this test measures nothing').toBe(true);
		return () => page.evaluate(() => (window as unknown as { __btWrites: number }).__btWrites);
	};

	test('pointer movement over a settled table writes no styles at all', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const writes = await countWrites(page);
		const box = (await page.locator('.bt-table').boundingBox())!;

		// Let the first hover settle. Revealing the strips CAN change layout
		// (reserving space for them), so a write here is not itself wrong — but
		// with the table-height-growth bug fixed (see table-height-growth.spec.ts),
		// there's nothing left inside the table's own scroll geometry for a
		// frozen cell to react to, so settling at exactly 0 is now the expected,
		// ideal case, not a sign the observer never attached. Waited on
		// QUIESCENCE rather than a fixed delay — a fixed one passed alone and
		// failed under a parallel run, where settling simply takes longer, which
		// would make this a flake rather than a finding.
		await page.mouse.move(box.x + 40, box.y + box.height / 2);
		let settled = -1;
		for (let i = 0; i < 40; i++) {
			await page.waitForTimeout(150);
			const now = await writes();
			if (now === settled) break;
			settled = now;
		}

		// Now move across every column seam — pointer movement only, no geometry
		// change, so a correct implementation has nothing to write.
		const seams = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.bt-sel-resize-col'))
				.map(h => h.getBoundingClientRect())
				.filter(r => r.width > 0 && r.x > 0)
				.slice(0, 6)
				.map(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })));
		expect(seams.length, 'no resize seams are visible, so the sweep below hits nothing').toBeGreaterThan(2);
		for (let pass = 0; pass < 6; pass++) {
			for (const s of seams) {
				await page.mouse.move(s.x - 5, s.y);
				await page.mouse.move(s.x + 5, s.y);
			}
		}
		await page.waitForTimeout(400);

		expect(await writes() - settled,
			'moving the pointer rewrote frozen cells\' inline styles — applyFreeze is no longer idempotent, which is what feeds a ResizeObserver feedback loop').toBe(0);
	});

	test('re-applying freeze with nothing changed writes nothing', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const writes = await countWrites(page);
		await page.waitForTimeout(200);
		const apply = (times: number) => page.evaluate((n) => {
			const table = document.querySelector('.bt-table') as HTMLTableElement;
			const thead = table.querySelector('thead') as HTMLElement;
			const tbody = table.querySelector('tbody') as HTMLElement;
			const model = (window as unknown as { __btModel: unknown }).__btModel;
			for (let i = 0; i < n; i++) window.RichTableReal.applyFreeze(table, thead, tbody, model);
		}, times);
		// One pass first, to sync: geometry can still settle after renderTable's own
		// last pass, so that first call legitimately has something to write.
		await apply(1);
		const before = await writes();
		await apply(10);
		expect(await writes() - before, 'a no-op pass still wrote styles').toBe(0);
	});

	test('a pass that genuinely changes something still writes', async ({ page, renderFull }) => {
		// Guards the guard: idempotence must not be implemented as "never write
		// twice". Changing the freeze counts has to take effect.
		await renderFull(SOURCE);
		const before = await page.evaluate(() => document.querySelectorAll('.bt-frozen-col').length);
		await page.evaluate(() => {
			const table = document.querySelector('.bt-table') as HTMLTableElement;
			const thead = table.querySelector('thead') as HTMLElement;
			const tbody = table.querySelector('tbody') as HTMLElement;
			const model = (window as unknown as { __btModel: { freezeCols?: number } }).__btModel;
			model.freezeCols = 1;
			window.RichTableReal.applyFreeze(table, thead, tbody, model);
		});
		const after = await page.evaluate(() => document.querySelectorAll('.bt-frozen-col').length);
		expect(after).toBeLessThan(before);
		expect(after).toBeGreaterThan(0);
	});
});
