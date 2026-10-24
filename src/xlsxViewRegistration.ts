/** The registry Obsidian keeps for views and file extensions. Only the public half is typed; the unregister half is internal. */
export interface ViewRegistryLike {
	unregisterExtensions?(extensions: string[]): void;
	unregisterView?(type: string): void;
}

export interface XlsxViewHooks {
	/** Claims the extension, then the view type. Throws, changing nothing, when another plugin owns the extension. */
	register(): void;
	registry: ViewRegistryLike | undefined;
	extension: string;
	viewType: string;
}

export type XlsxViewState =
	| { kind: 'owned' }
	| { kind: 'off' }
	| { kind: 'refused'; error: unknown };

/** What a settings change can do to a view that is already registered (or not). */
export type XlsxViewChange = XlsxViewState | { kind: 'needs-reload' };

export function enableXlsxView(hooks: XlsxViewHooks): XlsxViewState {
	try {
		hooks.register();
		return { kind: 'owned' };
	} catch (error) {
		return { kind: 'refused', error };
	}
}

/**
 * Gives the extension back at runtime. The extension goes first: unregistering the view makes
 * Obsidian reopen every tab of that type, and by then nothing may still claim the extension.
 * Without the internal methods the change waits for a reload instead.
 */
export function disableXlsxView(hooks: Pick<XlsxViewHooks, 'registry' | 'extension' | 'viewType'>): XlsxViewChange {
	const { registry } = hooks;
	if (!registry?.unregisterExtensions || !registry.unregisterView) return { kind: 'needs-reload' };
	registry.unregisterExtensions([hooks.extension]);
	registry.unregisterView(hooks.viewType);
	return { kind: 'off' };
}
