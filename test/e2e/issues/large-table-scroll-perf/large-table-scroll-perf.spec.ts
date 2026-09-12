import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

/**
 * Reported: an unlocked table with a tall, scrolled body felt noticeably
 * less smooth to scroll than a locked one. Root cause was in the row/column
 * selector strips — one `.bt-sel-cell`/drag-grip/resize-handle exists per
 * ROW and per COLUMN of the whole table (un-virtualized), and every one of
 * them used to track inner scroll via its OWN `left`/`top` (later `transform`)
 * referencing a shared CSS custom property set on an ancestor. Both of those
 * force a real style recalculation across every one of them on every scroll
 * frame — O(n) in row count, independent of whether the property that reads
 * the offset triggers layout.
 *
 * Fixed by moving the offset to a single shared `.bt-sel-track` wrapper per
 * strip (renderer.ts's rebuild()), with its `transform` set directly via
 * `style.setProperty` rather than a CSS custom property — a custom-property
 * write forces the browser to re-examine style for its whole descendant
 * subtree regardless of which descendant (if any) actually reads it,
 * measured at ~9ms/frame for a 300-row table vs ~0.02ms setting `transform`
 * directly. A frozen row/column's cell/grip/resize-handle is parented
 * OUTSIDE the track instead (a sibling, not a descendant), so it never
 * inherits the track's transform and stays fixed during scroll as before.
 *
 * This measures the actual coalesced-scroll-frame callback's CPU time,
 * bypassing real vsync/frame-pacing (which would otherwise dominate the
 * measurement) by intercepting requestAnimationFrame and invoking the
 * captured callback synchronously.
 */
test('the coalesced scroll-frame callback stays flat as row count grows', async ({ page, renderFull }) => {
	const measure = async (rows: number) => {
		const SOURCE = tableSource({
			widths: [80, 80, 80],
			rows: Array.from({ length: rows }, (_, i) => ({ 0: `r${i}a`, 1: `r${i}b`, 2: `r${i}c` })),
		});
		await renderFull(SOURCE);
		await page.locator('.bt-render-root').hover();
		await expect.poll(() => page.locator('.bt-strip-visible').count()).toBeGreaterThan(0);

		const samples: number[] = await page.evaluate(async () => {
			const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
			const realRAF = window.requestAnimationFrame.bind(window);
			const times: number[] = [];
			for (let i = 0; i < 10; i++) {
				wrapper.scrollTop = i * 5;
				let captured: FrameRequestCallback | null = null;
				window.requestAnimationFrame = (cb: FrameRequestCallback) => { captured = cb; return 0; };
				wrapper.dispatchEvent(new Event('scroll'));
				window.requestAnimationFrame = realRAF;
				if (captured) {
					const t0 = performance.now();
					captured(t0);
					times.push(performance.now() - t0);
				}
			}
			return times;
		});
		return samples.reduce((a, b) => a + b, 0) / samples.length;
	};

	const small = await measure(20);
	const large = await measure(600);

	// Generous absolute ceiling — this is what actually matters for feel (well
	// under a 16.6ms frame budget) — plus a growth-ratio check so an O(n)
	// regression (30x the row count) can't hide under a lenient absolute
	// number alone.
	expect(large, `600-row scroll frame took ${large.toFixed(2)}ms — investigate before it becomes visible jank`).toBeLessThan(5);
	expect(large, `scroll-frame cost grew with row count (small=${small.toFixed(2)}ms, large=${large.toFixed(2)}ms) — offset tracking regressed to per-cell instead of a shared transform`)
		.toBeLessThan(Math.max(small * 5, 2));
});
