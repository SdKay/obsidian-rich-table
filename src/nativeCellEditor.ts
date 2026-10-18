import type { App, Component } from 'obsidian';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

/**
 * Obsidian's own Markdown editor, mounted inside a table cell so `[[`, `==`,
 * `#tag` and slash completions behave exactly as in a note. The class is not in
 * the public typings: it is recovered from a throwaway markdown embed, the same
 * way other plugins that embed the editor do. Every step is checked, and `null`
 * from `getMarkdownEditorClass` means "fall back to the contenteditable editor".
 */

interface EditorOwner {
	app: App;
	editMode: unknown;
	readonly editor: unknown;
	readonly file: unknown;
	readonly path: string;
	getMode(): 'source';
	showSearch(): void;
	toggleMode(): void;
	onMarkdownScroll(): void;
	scroll: number;
}

type MarkdownEditorCtor = new (app: App, containerEl: HTMLElement, owner: EditorOwner) => NativeEditorInstance;

interface NativeEditorInstance extends Component {
	cm: EditorView;
	editor: unknown;
	set(value: string): void;
	get(): string;
	buildLocalExtensions(): unknown[];
	onUpdate(update: unknown, changed: boolean): void;
}

interface EmbedRegistry {
	embedByExtension: { md?: (ctx: { app: App; containerEl: HTMLElement; state: object }, file: null, subpath: string) => EmbedLike };
}
interface EmbedLike {
	load(): void; unload(): void; showEditor(): void; editable: boolean;
	editMode: object | null;
}

let cached: MarkdownEditorCtor | null | undefined;

export function getMarkdownEditorClass(app: App): MarkdownEditorCtor | null {
	if (cached !== undefined) return cached;
	cached = null;
	try {
		const registry = (app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
		const make = registry?.embedByExtension.md;
		if (!make) return cached;
		const embed = make({ app, containerEl: createDiv(), state: {} }, null, '');
		embed.load();
		embed.editable = true;
		embed.showEditor();
		const proto: unknown = embed.editMode && Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode));
		embed.unload();
		const ctor = (proto as { constructor?: unknown } | null)?.constructor;
		if (typeof ctor === 'function' && typeof (ctor.prototype as { buildLocalExtensions?: unknown }).buildLocalExtensions === 'function') {
			cached = ctor as MarkdownEditorCtor;
		}
	} catch {
		cached = null;
	}
	return cached;
}

export interface NativeCellEditorOptions {
	app: App;
	host: HTMLElement;
	owner: Component;
	sourcePath: string;
	value: string;
	/** Enter / Escape / Tab as the cell sees them; return true to claim the key. */
	onKey: (key: 'Enter' | 'Escape' | 'Tab' | 'Shift-Tab') => void;
	onChange?: (value: string) => void;
}

export interface NativeCellEditor {
	view: EditorView;
	getValue(): string;
	focus(): void;
	/** Selects all text, or puts the caret at the end. */
	select(all: boolean): void;
	destroy(): void;
}

/** Mounts the native editor in `host`, or returns null when it is unavailable. */
export function mountNativeCellEditor(opts: NativeCellEditorOptions): NativeCellEditor | null {
	const Base = getMarkdownEditorClass(opts.app);
	if (!Base) return null;
	const { onKey, onChange } = opts;

	class CellEditor extends Base {
		buildLocalExtensions(): unknown[] {
			const ext = super.buildLocalExtensions();
			const claim = (key: Parameters<typeof onKey>[0]) => () => { onKey(key); return true; };
			ext.push(Prec.highest(keymap.of([
				{ key: 'Enter', run: claim('Enter'), preventDefault: true },
				{ key: 'Escape', run: claim('Escape'), preventDefault: true },
				{ key: 'Tab', run: claim('Tab'), preventDefault: true },
				{ key: 'Shift-Tab', run: claim('Shift-Tab'), preventDefault: true },
			])));
			return ext;
		}
		onUpdate(update: unknown, changed: boolean): void {
			super.onUpdate(update, changed);
			if (changed) onChange?.(this.get());
		}
		updateBottomPadding(): void { /* no note-sized padding inside a cell */ }
	}

	const owner: EditorOwner = {
		app: opts.app,
		editMode: null,
		get editor() { return editor.editor; },
		file: null,
		path: opts.sourcePath,
		getMode: () => 'source',
		showSearch: () => undefined,
		toggleMode: () => undefined,
		onMarkdownScroll: () => undefined,
		scroll: 0,
	};
	const editor = new CellEditor(opts.app, opts.host, owner);
	owner.editMode = editor;
	opts.owner.addChild(editor);
	editor.set(opts.value);

	return {
		view: editor.cm,
		getValue: () => editor.get(),
		focus: () => editor.cm.focus(),
		select: all => {
			const end = editor.cm.state.doc.length;
			editor.cm.dispatch({ selection: { anchor: all ? 0 : end, head: end } });
		},
		destroy: () => opts.owner.removeChild(editor),
	};
}

let nativeEditorOn = false;
/** Kept in step with the setting by the plugin, so cell code needs no plumbing. */
export const setNativeEditorEnabled = (on: boolean): void => { nativeEditorOn = on; };
export const nativeEditorEnabled = (): boolean => nativeEditorOn;
