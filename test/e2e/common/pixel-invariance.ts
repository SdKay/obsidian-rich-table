import { expect, type Page } from '@playwright/test';

/**
 * THE INVARIANT: the frozen block (frozen rows × frozen columns) is by
 * definition pinned, so its rendered pixels MUST be identical at scroll offset 0
 * and at every other scroll offset. Anything else — a line that vanishes, a
 * cell's text getting covered, a 1px shift — is a real defect, whatever its
 * mechanism.
 *
 * This exists because a whole class of freeze bugs is INVISIBLE to computed-style
 * assertions: every border-color/box-shadow/background value can read back
 * exactly as intended while the region still renders wrong, because the bug is
 * in WHERE things end up painted, not in what the cascade resolved to. Three
 * separate causes (a 1px sticky-offset error, collapsed borders that belong to
 * the table instead of the cell, and a sticky <tr> painting over the row above's
 * rowSpan cell) all slipped past a full suite of computed-style checks, and this
 * is the assertion that catches all three.
 *
 * Screenshots are diffed inside the page via canvas — no image dependency needed
 * — and the diff's bounding box is reported on failure so a regression says
 * WHERE it broke, not just that it broke.
 */

const DIFF_HELPER = `
window.__btPixelDiff = async (aB64, bB64) => {
	const load = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
	const [a, b] = await Promise.all([load(aB64), load(bB64)]);
	const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
	const grab = (img) => {
		const c = new OffscreenCanvas(w, h);
		const x = c.getContext('2d');
		x.drawImage(img, 0, 0);
		return x.getImageData(0, 0, w, h).data;
	};
	const da = grab(a), db = grab(b);
	let n = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const i = (y * w + x) * 4;
		// 8/255 tolerance: ignores the sub-pixel antialiasing difference a
		// fractional column width can produce, while any real missing line,
		// covered glyph or whole-block shift is far above it.
		if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i+1] - db[i+1]) > 8 || Math.abs(da[i+2] - db[i+2]) > 8) {
			n++;
			if (x < minX) minX = x; if (x > maxX) maxX = x;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
		}
	}
	return { diff: n, box: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
};
`;

export interface FrozenBlockRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Live geometry of the frozen block, plus how far the wrapper can scroll. */
export async function frozenBlockGeometry(page: Page): Promise<{ clip: FrozenBlockRect; maxScrollLeft: number; maxScrollTop: number }> {
	return await page.evaluate(() => {
		const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const table = document.querySelector('.bt-table') as HTMLElement;
		const box = wrapper.getBoundingClientRect();
		const model = (window as unknown as { __btModel: { freezeRows?: number; freezeCols?: number } }).__btModel;
		let width = 0;
		const cols = Array.from(table.querySelectorAll('col'));
		for (let i = 0; i < (model.freezeCols ?? 0); i++) width += cols[i]?.getBoundingClientRect().width ?? 0;
		let height = 0;
		const rows = Array.from(table.querySelectorAll('tr')).filter(tr => tr.querySelector('[data-row]'));
		for (let i = 0; i <= (model.freezeRows ?? 0); i++) height += rows[i]?.getBoundingClientRect().height ?? 0;
		return {
			// Inset by 2px on the right/bottom: a fractional block edge would
			// otherwise put a sliver of the scrolling region inside the clip, which
			// legitimately changes and isn't what's under test.
			clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(1, Math.floor(width) - 2), height: Math.max(1, Math.floor(height) - 2) },
			maxScrollLeft: wrapper.scrollWidth - wrapper.clientWidth,
			maxScrollTop: wrapper.scrollHeight - wrapper.clientHeight,
		};
	});
}

/**
 * Asserts the frozen block renders identically at every given scroll position.
 *
 * `offsets` are [scrollLeft, scrollTop] pairs. A negative value means "scroll to
 * the maximum on that axis", so a test can cover the end stop without hardcoding
 * a number that changes with the fixture.
 */
export async function expectFrozenBlockInvariant(page: Page, offsets: [number, number][], maxDiffPx = 0): Promise<void> {
	await page.addScriptTag({ content: DIFF_HELPER });
	const { clip, maxScrollLeft, maxScrollTop } = await frozenBlockGeometry(page);
	// Only offsets that are a whole number of DEVICE pixels are checked. At a
	// fractional devicePixelRatio (1.5, say) a scroll of 1 CSS px is 1.5 device
	// px, so the browser translates every sticky element back by half a device
	// pixel and the whole frozen block legitimately re-rasterizes — measured as
	// hundreds of differing pixels across all four themes, and equally on a table
	// with no freeze at all, i.e. not something this codebase causes or can
	// prevent. "The pixels must be identical" is only a well-posed claim when the
	// scroll delta lands on the device grid; the line-painted and leak probes in
	// appearance-probe.ts are what cover the offsets skipped here.
	const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
	const aligned = (v: number) => Number.isInteger(v * dpr);
	// KNOWN, BOUNDED, NOT FULLY ISOLATED: at a fractional dpr a single 1px-wide
	// gridline inside the block can still re-rasterize between offsets that ARE
	// device-aligned (measured: 7-40 px, always a 1-device-pixel-tall or -wide
	// strip). The cause wasn't pinned down; what IS established is that it's
	// confined to one hairline. So allow one line's worth of pixels at fractional
	// dpr and nothing at all at integer dpr, rather than either failing on a known
	// artifact or blanket-widening the tolerance: every real defect this assertion
	// has caught was 265-10516 px, and a leak or a missing line is caught outright
	// by the probes in appearance-probe.ts regardless of this allowance.
	const hairline = Number.isInteger(dpr) ? 0 : Math.ceil(Math.max(clip.width, clip.height) * dpr);
	const budget = Math.max(maxDiffPx, hairline);

	const shoot = async (left: number, top: number): Promise<string> => {
		await page.evaluate(([l, t]) => {
			const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
			wrapper.scrollLeft = l; wrapper.scrollTop = t;
		}, [left < 0 ? maxScrollLeft : left, top < 0 ? maxScrollTop : top]);
		// One frame for the scroll to be painted before the screenshot.
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		return (await page.screenshot({ clip })).toString('base64');
	};

	const base = await shoot(0, 0);
	let checked = 0;
	for (const [left, top] of offsets) {
		const l = left < 0 ? maxScrollLeft : left, t = top < 0 ? maxScrollTop : top;
		if (!aligned(l) || !aligned(t)) continue;
		checked++;
		const shot = await shoot(left, top);
		const result = await page.evaluate(([a, b]) => window.__btPixelDiff(a, b), [base, shot]);
		expect(result.diff, `frozen block changed at scrollLeft=${left}, scrollTop=${top} — ${result.diff} px differ` +
			(result.box ? ` in a ${result.box.w}x${result.box.h} region at (${result.box.x},${result.box.y}) of the block` : '') +
			`. The frozen block is pinned, so it must render identically at every scroll offset.`)
			.toBeLessThanOrEqual(budget);
	}
	// Never let the device-alignment filter silently empty the whole assertion.
	expect(checked, `no device-pixel-aligned offsets among [${offsets.map(o => o.join('/')).join(', ')}] at dpr ${dpr} — this assertion checked nothing`).toBeGreaterThan(0);
}

declare global {
	interface Window {
		__btPixelDiff: (a: string, b: string) => Promise<{ diff: number; box: { x: number; y: number; w: number; h: number } | null }>;
		/** The model actually rendered — published by test-base.ts's renderReal. */
		__btModel: { freezeRows?: number; freezeCols?: number };
	}
}
