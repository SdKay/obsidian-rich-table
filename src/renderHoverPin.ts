import type { Menu } from 'obsidian';

/**
 * Obsidian's native `Menu` and this plugin's own floating cell/filter panels
 * (`renderPanel.ts`) render outside the table's own DOM subtree — they're
 * appended to `document.body`, not to `.bt-render-root`. Moving the mouse from
 * the table onto one of them therefore fires a genuine `mouseleave` on the
 * table root, which used to immediately collapse the hover-only selector
 * strips / edge-add-row-col strips mid-interaction, causing a layout jump; the
 * strips would then reappear the moment the mouse re-entered the table.
 *
 * This module tracks "is a popup we opened still showing" as a simple counter
 * (shared across every table on the page — only one popup is ever open across
 * the whole app at a time in practice, and each table's own unpin-listener
 * independently re-checks its own root before acting, so sharing the counter
 * is safe). `renderer.ts`'s root `mouseleave` handler checks `isHoverPinned()`
 * and, while pinned, defers hiding until the popup actually closes.
 */
let openPopupCount = 0;
const onAllClosedListeners = new Set<() => void>();

/**
 * The cell whose value-picker menu is currently open, if any. Tracked here
 * because a `Menu` renders to document.body, outside the table's own subtree —
 * so unlike a text/date editor there is no `.bt-editing` cell to find it by, and
 * keyboard navigation (renderer.ts) otherwise has no way to know a cell is
 * mid-interaction.
 */
interface ActiveCellMenu { menu: Menu; row: number; col: number; }
let activeCellMenu: ActiveCellMenu | null = null;

export function isHoverPinned(): boolean {
	return openPopupCount > 0;
}

/**
 * Call when a popup (menu/panel) opens. Returns a release function — call it
 * exactly once when that popup closes. Safe to call the release function more
 * than once (e.g. from both a Menu's `onHide` and a manual close path).
 */
export function pinHover(): () => void {
	openPopupCount++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		openPopupCount = Math.max(0, openPopupCount - 1);
		if (openPopupCount === 0) for (const fn of onAllClosedListeners) fn();
	};
}

/**
 * Registered once per table root (renderer.ts): runs when the last pinning
 * popup closes, so the root can re-check whether the mouse is still actually
 * over it and hide the strips only if not. Returns an unsubscribe function —
 * callers should run it via `component.register()` to avoid leaking the
 * closure past the table's own lifetime.
 */
export function onHoverUnpinned(fn: () => void): () => void {
	onAllClosedListeners.add(fn);
	return () => onAllClosedListeners.delete(fn);
}

/**
 * Convenience wrapper for the common `new Menu(); ...; menu.showAtMouseEvent(evt)`
 * pattern. Passing `cell` additionally records this as that cell's open
 * value-picker menu (see getActiveCellMenu), so keyboard navigation can tell the
 * cell is mid-interaction and close the menu before moving on.
 */
export function showMenuPinned(menu: Menu, evt: MouseEvent, cell?: { row: number; col: number }): void {
	const unpin = pinHover();
	if (cell) activeCellMenu = { menu, row: cell.row, col: cell.col };
	menu.onHide(() => {
		unpin();
		// Guarded: by the time this menu hides, a different cell's menu may already
		// have taken the slot, and clearing it would strand that one as untracked.
		if (activeCellMenu?.menu === menu) activeCellMenu = null;
	});
	menu.showAtMouseEvent(evt);
}

/** The cell whose value-picker menu is open, plus a way to close it. */
export function getActiveCellMenu(): { row: number; col: number; close: () => void } | null {
	if (!activeCellMenu) return null;
	const { menu, row, col } = activeCellMenu;
	return { row, col, close: () => menu.hide() };
}
