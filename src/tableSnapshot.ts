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

/** Hover-only chrome, scroll-affordances, and the status bar / sheet tab bar
 *  — none of these have a place in a static, fully-expanded snapshot (the
 *  status bar's own totals/tabs are chrome ABOUT the table, not the table's
 *  content, and the sheet tab bar reflects an interactive multi-sheet
 *  workbook UI, not something meant to be shared as a picture of one sheet).
 *  `.bt-sheet-tabbar` is listed on its own, not just implied by
 *  `.bt-status-bar`, because it has two possible mount points (tableBlock.ts):
 *  nested inside `.bt-status-bar .bt-status-tabs` for a table-view sheet, or
 *  a separate standalone bar when the active sheet is a kanban/calendar view
 *  (which renders no status bar of its own at all). See
 *  prepareSnapshotClone's own doc comment for why removing these here (on a
 *  detached clone) is safe, unlike removing them from the live table. */
const STRIP_SELECTORS = [
	'.bt-ctrl-col',
	'.bt-col-selector',
	'.bt-row-selector',
	'.bt-edge-add-row',
	'.bt-edge-add-col',
	'.bt-view-resize-r',
	'.bt-view-resize-br',
	'.bt-view-resize-b',
	'.bt-status-bar',
	'.bt-sheet-tabbar',
].join(', ');

const SNAPSHOT_OPTIONS: Parameters<typeof htmlToImage.toBlob>[1] = {
	pixelRatio: 2, // crisp regardless of the screen's actual DPI — the whole point of this feature
	skipFonts: true, // avoid a slow/fragile fetch-and-embed of every @font-face the current theme happens to reference
	imagePlaceholder: '', // a remote (non-vault) cell image that fails to fetch renders blank instead of failing the whole capture
};

/**
 * Clones `root` and returns a version prepared for capture:
 *  - hover-only chrome removed (STRIP_SELECTORS) — safe to mutate freely
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
function prepareSnapshotClone(root: HTMLElement): { clone: HTMLElement; cleanup: () => void } {
	const clone = root.cloneNode(true) as HTMLElement;
	clone.querySelectorAll(STRIP_SELECTORS).forEach(el => el.remove());

	// --bt-sel-pad(-left/-right) is `root`'s own inline-style reservation for
	// the hover selector strips/edge-add buttons (renderer.ts's TOP_STRIP_PAD
	// et al) — set once at first paint and, for an UNTITLED table
	// specifically, padded an extra 28px on top so the strip clears
	// Obsidian's own floating block toolbar (see the no-title-top-clearance
	// e2e test). Cloning `root` carries this inline style over verbatim,
	// leaving a tall blank band above an untitled table's snapshot even
	// though the strips themselves are already stripped above — this
	// reservation has no purpose once there's no strip left to reserve room
	// for. Removed here, not on the live root, for the same reason
	// everything else in this function only ever touches the clone.
	clone.style.removeProperty('--bt-sel-pad');
	clone.style.removeProperty('--bt-sel-pad-left');
	clone.style.removeProperty('--bt-sel-pad-right');

	const wrapper = clone.querySelector<HTMLElement>('.bt-table-wrapper');
	if (wrapper) {
		wrapper.classList.remove('bt-view-fixed-w', 'bt-view-fixed-h');
		wrapper.classList.add('bt-snapshot-expanded');
	}

	const host = document.body.createDiv({ cls: 'bt-snapshot-host' });
	host.appendChild(clone);

	return { clone, cleanup: () => host.remove() };
}

export async function captureTablePng(root: HTMLElement): Promise<Blob> {
	const { clone, cleanup } = prepareSnapshotClone(root);
	try {
		const blob = await htmlToImage.toBlob(clone, SNAPSHOT_OPTIONS);
		if (!blob) throw new Error('toBlob produced no image');
		return blob;
	} finally {
		cleanup();
	}
}

/** `htmlToImage.toSvg` returns a `data:image/svg+xml;charset=utf-8,...` data
 *  URL, not raw markup — decode it, since the caller writes this straight
 *  into a `.svg` file; saving the data URL verbatim would produce a file
 *  that isn't valid SVG (no viewer renders a data-URL string as an image). */
export async function captureTableSvg(root: HTMLElement): Promise<string> {
	const { clone, cleanup } = prepareSnapshotClone(root);
	try {
		const dataUrl = await htmlToImage.toSvg(clone, SNAPSHOT_OPTIONS);
		return decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
	} finally {
		cleanup();
	}
}
