/**
 * Minimal structural interface for the class-list operations `applyThemeClass`
 * needs — deliberately not `HTMLElement` so this stays testable without a DOM.
 * A real HTMLElement (with Obsidian's addClass/removeClass extensions) satisfies
 * this structurally, so callers can pass one in directly.
 */
export interface ThemeableEl {
	// ArrayLike (not Iterable) so a real DOMTokenList — whose TS lib typing
	// doesn't declare Symbol.iterator under this project's lib config — still
	// satisfies this structurally; Array.from() accepts either shape.
	classList: ArrayLike<string>;
	addClass(cls: string): void;
	removeClass(cls: string): void;
}

/**
 * Swap only the `bt-theme-*` class on `el`, leaving every other class untouched.
 * A prior version of this logic (tableBlock.ts's set-theme instant-apply) did a
 * blanket `el.className = 'bt-render-root bt-theme-x'` overwrite, which silently
 * wiped unrelated state classes like `bt-has-strips` — that class gates
 * `position: absolute` for the edge-add/selector strips (styles.css), so losing
 * it dropped them into normal document flow, visible as stray "+" buttons in
 * blank space the moment a table's theme was switched while hovering.
 */
export function applyThemeClass(el: ThemeableEl, theme: string | null): void {
	Array.from(el.classList)
		.filter(c => c.startsWith('bt-theme-'))
		.forEach(c => el.removeClass(c));
	if (theme) el.addClass(`bt-theme-${theme}`);
}
