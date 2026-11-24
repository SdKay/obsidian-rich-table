/**
 * Rasterizes a rendered table's DOM into a PNG blob or SVG string, for the
 * left-toolbar snapshot button — the plugin's answer to "I have to zoom in
 * on Obsidian and take a screenshot to get something sharp enough to share."
 *
 * There is no OS- or Electron-level "screenshot this element" API reachable
 * from a plugin (that capability lives in Electron's main process, which
 * Obsidian doesn't expose to plugins) — so this uses the same technique any
 * web app does: clone the DOM, serialize it into an SVG `<foreignObject>`,
 * and rasterize that through a `<canvas>`. `html-to-image` implements that
 * technique; this module is just the table-specific policy on top of it —
 * which parts of the live DOM to strip before handing it off, and how to
 * make hidden/scrolled content fully visible first.
 */
import * as htmlToImage from 'html-to-image';
import { contentEndRow } from './snapshotEnd';
import { withPixelDensity } from './pngDensity';
import { stripToTable } from './staticClone';

const SNAPSHOT_PIXEL_RATIO = 2;
const SNAPSHOT_OPTIONS: NonNullable<Parameters<typeof htmlToImage.toBlob>[1]> = {
	pixelRatio: SNAPSHOT_PIXEL_RATIO, // crisp regardless of the screen's actual DPI — the whole point of this feature
	skipFonts: true, // avoid a slow/fragile fetch-and-embed of every @font-face the current theme happens to reference
	imagePlaceholder: '', // a remote (non-vault) cell image that fails to fetch renders blank instead of failing the whole capture
};

/**
 * Clones `root` and returns a version prepared for capture:
 *  - hover-only chrome removed (staticClone.ts) — safe to mutate freely
 *    here specifically BECAUSE it's a clone with no event listeners and no
 *    effect on the live table, unlike the render-cache placeholder's more
 *    careful de-fanging of a clone that's still shown to the user.
 *  - `.bt-table-wrapper`'s scroll bounds removed (the `bt-snapshot-expanded`
 *    class in styles.css, `!important` throughout so it reliably wins over
 *    that rule regardless of source order), so a table that's taller/wider
 *    than its current view (max-height: 70vh by default, or an explicit
 *    viewWidth/viewHeight) renders at its full natural size — a snapshot is
 *    for sharing the whole table, not whatever slice happens to be scrolled
 *    into view. The `bt-view-fixed-w`/`-h` classes are removed too, even
 *    though `!important` would win over them either way, since leaving them
 *    on is misleading (they'd claim a manual size that no longer applies).
 * The clone is attached off-screen (`position: fixed`, far outside the
 * viewport) rather than `display: none` — html-to-image (like any DOM-to-
 * image approach) needs the node genuinely laid out to measure it.
 */
function prepareSnapshotClone(root: HTMLElement): { clone: HTMLElement; size: { width: number; height: number }; cleanup: () => void } {
	const clone = root.cloneNode(true) as HTMLElement;
	const wrapper = stripToTable(clone);
	if (wrapper) {
		// The clone is laid out as wide as the note's view is, to the fraction (clientWidth rounds it), so columns that
		// wrap break where they do in the note; a table wider than the view keeps its own width.
		const zoom = Number.parseFloat(root.style.zoom) || 1;
		const liveWrapper = root.querySelector<HTMLElement>('.bt-table-wrapper');
		const liveTable = root.querySelector<HTMLElement>('table.bt-table');
		const width = Math.max((liveWrapper?.getBoundingClientRect().width ?? 0) / zoom, (liveTable?.getBoundingClientRect().width ?? 0) / zoom);
		if (width > 0) wrapper.setCssProps({ '--bt-snapshot-width': `${width}px` });
	}

	// Beside the live table, under the same ancestors, so the note's own rules (fonts, cell sizes, theme) apply to it
	// exactly as they do to the table.
	const host = (root.parentElement ?? document.body).createDiv({ cls: 'bt-snapshot-host' });
	host.appendChild(clone);

	// Text wraps by the glyph widths of the zoom it is laid out at, so the clone keeps the note's zoom. The library takes
	// clientWidth/Height, which leave a CSS `zoom` out, so the canvas is given the box measured on screen.
	const rect = clone.getBoundingClientRect();
	// The table sits centred in the view's width, which it was laid out against; the picture is only the table.
	const row = clone.querySelector<HTMLElement>('.bt-table-content-row');
	if (wrapper && row) {
		const zoom = Number.parseFloat(root.style.zoom) || 1;
		const rowWidth = row.getBoundingClientRect().width / zoom;
		if (rowWidth > 0) {
			wrapper.setCssProps({ '--bt-snapshot-width': `${rowWidth}px` });
			const tight = clone.getBoundingClientRect();
			return { clone, size: { width: Math.ceil(tight.width), height: Math.ceil(tight.height) }, cleanup: () => host.remove() };
		}
	}
	return { clone, size: { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }, cleanup: () => host.remove() };
}

/**
 * How tall the picture comes out, in the clone's own px. The page cannot say (see snapshotEnd.ts): the clone is drawn
 * with room to spare, carrying a marker as its last element, and the height is where the marker begins.
 */
async function measureHeight(clone: HTMLElement, size: { width: number; height: number }): Promise<number> {
	const marker = clone.createDiv({ cls: 'bt-snapshot-end' });
	try {
		const room = { ...size, height: Math.ceil(size.height * 1.5) + 8 };
		const probe = await htmlToImage.toCanvas(clone, { ...SNAPSHOT_OPTIONS, ...room });
		const strip = probe.getContext('2d')?.getImageData(Math.floor(probe.width / 2), 0, 1, probe.height).data;
		const end = strip ? contentEndRow(strip) : null;
		return end === null ? size.height : Math.ceil(end / (probe.width / room.width));
	} finally {
		marker.remove();
	}
}

export async function captureTablePng(root: HTMLElement): Promise<Blob> {
	const { clone, size, cleanup } = prepareSnapshotClone(root);
	try {
		const blob = await htmlToImage.toBlob(clone, { ...SNAPSHOT_OPTIONS, ...size, height: await measureHeight(clone, size) });
		if (!blob) throw new Error('toBlob produced no image');
		return new Blob([withPixelDensity(new Uint8Array(await blob.arrayBuffer()), SNAPSHOT_PIXEL_RATIO) as BlobPart], { type: 'image/png' });
	} finally {
		cleanup();
	}
}

/** `htmlToImage.toSvg` returns a `data:image/svg+xml;charset=utf-8,...` data
 *  URL, not raw markup — decode it, since the caller writes this straight
 *  into a `.svg` file; saving the data URL verbatim would produce a file
 *  that isn't valid SVG (no viewer renders a data-URL string as an image). */
export async function captureTableSvg(root: HTMLElement): Promise<string> {
	const { clone, size, cleanup } = prepareSnapshotClone(root);
	try {
		const dataUrl = await htmlToImage.toSvg(clone, { ...SNAPSHOT_OPTIONS, ...size, height: await measureHeight(clone, size) });
		return decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
	} finally {
		cleanup();
	}
}
