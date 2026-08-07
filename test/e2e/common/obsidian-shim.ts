/**
 * Stands in for the `obsidian` module when bundling the real source for e2e
 * tests (esbuild aliases the bare import to this file — see build-bundle.mjs).
 *
 * Why this has to exist: the `obsidian` npm package is types-only, with no
 * runtime at all. So anything importing it couldn't be exercised in a plain
 * browser, which for a long time meant the harness could only run the pieces
 * that don't — the parser, the freeze pass, style resolution. `renderTable`
 * itself was out of reach, so every interactive surface (hover strips, floating
 * panels, cell editing) had zero coverage, and a real hang in the selector
 * strips' hover path could only be diagnosed by guessing and asking the user to
 * try again.
 *
 * The goal is NOT to reimplement Obsidian. It's to be faithful in exactly the
 * respects the plugin's layout and event behaviour depend on:
 *   - the DOM shape produced (a rendered cell must get the same box as in
 *     Obsidian, so MarkdownRenderer.render emits a <p> like the real one)
 *   - synchronous-vs-async timing of anything the plugin awaits
 *   - Component's registration lifecycle, since several hover/freeze fixes are
 *     implemented as cleanup registrations and would silently not run
 * Everything beyond that (menu chrome, notices, icon glyphs) is a stub on
 * purpose — a test depending on it would be testing this file.
 *
 * Kept separate from test/__mocks__/obsidian.ts (vitest's alias), which only
 * needs YAML: that one runs in Node against pure logic, this one runs in a
 * browser against the renderer.
 */
import * as yaml from 'js-yaml';

export function parseYaml(src: string): unknown {
	return yaml.load(src);
}

export function stringifyYaml(obj: unknown): string {
	return yaml.dump(obj, { lineWidth: -1, quotingType: '"', forceQuotes: false });
}

export function getLanguage(): string {
	return 'en';
}

/**
 * Faithful in the one respect the plugin relies on: registered callbacks run
 * exactly once on unload, and children unload with their parent. Hover-pin
 * release and resize-indicator cleanup are both cleanup registrations, so
 * getting this wrong would disable them quietly rather than fail loudly.
 */
export class Component {
	_loaded = false;
	_children: Component[] = [];
	_cleanups: (() => void)[] = [];

	load(): void {
		if (this._loaded) return;
		this._loaded = true;
		this.onload();
		for (const c of this._children) c.load();
	}
	onload(): void { /* subclasses override */ }
	unload(): void {
		if (!this._loaded) return;
		this._loaded = false;
		for (const c of this._children.splice(0)) c.unload();
		for (const fn of this._cleanups.splice(0)) fn();
		this.onunload();
	}
	onunload(): void { /* subclasses override */ }
	addChild<T extends Component>(child: T): T {
		this._children.push(child);
		if (this._loaded) child.load();
		return child;
	}
	removeChild<T extends Component>(child: T): T {
		const i = this._children.indexOf(child);
		if (i >= 0) this._children.splice(i, 1);
		child.unload();
		return child;
	}
	register(cb: () => void): void {
		this._cleanups.push(cb);
	}
	registerEvent(): void { /* no event bus here */ }
	registerDomEvent(el: EventTarget, type: string, cb: EventListenerOrEventListenerObject): void {
		el.addEventListener(type, cb);
		this.register(() => el.removeEventListener(type, cb));
	}
	registerInterval(id: number): number {
		this.register(() => window.clearInterval(id));
		return id;
	}
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}

/**
 * The real one parses markdown into block elements. Cell layout depends on the
 * <p> it produces (styles.css sets `p { margin: 0 }` inside cells, and the
 * empty-cell height fix relies on a paragraph existing), so that shape is
 * reproduced; inline markdown is not parsed, since no layout question turns on
 * whether `**a**` came out bold.
 *
 * Async like the real one — renderTable awaits it per cell, and collapsing that
 * to synchronous would hide any ordering bug that depends on the await.
 */
export const MarkdownRenderer = {
	render(_app: unknown, markdown: string, el: HTMLElement, _sourcePath: string, _component: unknown): Promise<void> {
		if (markdown !== '') el.createEl('p', { text: markdown });
		return Promise.resolve();
	},
};

export class MenuItem {
	title = '';
	icon = '';
	checked = false;
	disabled = false;
	callback: ((evt: MouseEvent) => unknown) | null = null;
	setTitle(title: string | DocumentFragment): this { this.title = String(title instanceof DocumentFragment ? title.textContent : title); return this; }
	setIcon(icon: string | null): this { this.icon = icon ?? ''; return this; }
	setChecked(checked: boolean): this { this.checked = checked; return this; }
	setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
	setSection(): this { return this; }
	setIsLabel(): this { return this; }
	onClick(cb: (evt: MouseEvent) => unknown): this { this.callback = cb; return this; }
	setSubmenu(): Menu { return new Menu(); }
}

/**
 * Not rendered, but menus ARE tracked: the hover-pin mechanism
 * (renderHoverPin.ts) hangs on `onHide`, and a menu that never reported hiding
 * would leak the pin count and pin the strips open forever. Tests drive entries
 * through `Menu.opened` / `clickItem`.
 */
export class Menu {
	static opened: Menu[] = [];
	items: MenuItem[] = [];
	private hideCbs: (() => void)[] = [];
	addItem(cb: (item: MenuItem) => void): this {
		const item = new MenuItem();
		cb(item);
		this.items.push(item);
		return this;
	}
	addSeparator(): this { return this; }
	setNoIcon(): this { return this; }
	onHide(cb: () => void): this { this.hideCbs.push(cb); return this; }
	showAtMouseEvent(): this { Menu.opened.push(this); return this; }
	showAtPosition(): this { Menu.opened.push(this); return this; }
	hide(): this {
		const i = Menu.opened.indexOf(this);
		if (i >= 0) Menu.opened.splice(i, 1);
		for (const cb of this.hideCbs.splice(0)) cb();
		return this;
	}
	/** Test helper: invoke the entry with this exact title. */
	clickItem(title: string): boolean {
		const item = this.items.find(i => i.title === title);
		if (!item?.callback) return false;
		item.callback(new MouseEvent('click'));
		return true;
	}
}

/**
 * Obsidian injects an SVG. An attribute is enough, and keeps every measured box
 * independent of an icon glyph this harness doesn't have.
 */
export function setIcon(el: HTMLElement, icon: string): void {
	el.dataset.icon = icon;
}

export class Notice {
	static shown: string[] = [];
	constructor(message: string | DocumentFragment) {
		Notice.shown.push(String(message instanceof DocumentFragment ? message.textContent : message));
	}
	setMessage(): this { return this; }
	hide(): void { /* nothing to hide */ }
}

export class App { }
export class TFile { path = ''; basename = ''; extension = 'md'; }
export class MarkdownView { }
export class Plugin extends Component { }
export class PluginSettingTab { }
export class Setting { constructor(_el?: HTMLElement) { /* settings UI isn't exercised */ } }

/** The plugin subclasses this for wikilink autocomplete; nothing needs to popup. */
export class AbstractInputSuggest<T> {
	app: unknown;
	textInputEl: HTMLElement;
	constructor(app: unknown, textInputEl: HTMLElement) {
		this.app = app;
		this.textInputEl = textInputEl;
	}
	/**
	 * The real API's selection hook. Present because its ABSENCE broke edit mode
	 * outright rather than merely degrading suggestions: WikilinkInputSuggest calls
	 * onSelect from its constructor, so a missing method threw there, which aborted
	 * the rest of enterEditMode — including the editor's focus() call. The editor
	 * appeared, took no keystrokes, and nothing looked wrong. A shim missing a
	 * method fails in whatever came after it, not where it's missing.
	 */
	onSelect(cb: (value: T, evt: MouseEvent | KeyboardEvent) => void): void {
		this.selectCb = cb;
	}
	protected selectCb: ((value: T, evt: MouseEvent | KeyboardEvent) => void) | null = null;
	/** Test hook: pick a suggestion as the user would. */
	chooseSuggestion(value: T): void {
		this.selectCb?.(value, new MouseEvent('click'));
	}
	setLimit(_n: number): void { /* no popup to limit */ }
	getSuggestions(_query: string): T[] | Promise<T[]> { return []; }
	renderSuggestion(_value: T, _el: HTMLElement): void { /* not rendered */ }
	selectSuggestion(_value: T): void { /* not selectable */ }
	getValue(): string { return ''; }
	setValue(_v: string): void { /* no-op */ }
	close(): void { /* nothing open */ }
}
