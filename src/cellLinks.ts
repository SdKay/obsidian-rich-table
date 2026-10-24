export interface CellLink {
	kind: 'internal' | 'external';
	/** The link's target: a note name with an optional #heading, or a URL. */
	href: string;
}

/**
 * The link an event landed on, if it is a rendered `[[wikilink]]` or Markdown link inside `container`.
 * Obsidian routes these clicks itself only for a Markdown view's own content, so a view that renders
 * cells somewhere else has to do it.
 */
export function linkAt(target: EventTarget | null, container: HTMLElement): CellLink | null {
	if (!(target instanceof Element)) return null;
	const a = target.closest<HTMLElement>('a.internal-link, a.external-link');
	if (!a || !container.contains(a)) return null;
	const href = a.getAttribute('data-href') ?? '';
	if (href === '') return null;
	return { kind: a.classList.contains('internal-link') ? 'internal' : 'external', href };
}

export interface CellLinkOpener {
	/** Obsidian's workspace.openLinkText: resolves the note name, creates it if missing. */
	openInternal(href: string, sourcePath: string, newLeaf: string | boolean): void;
	openExternal(href: string): void;
	/** Obsidian's Keymap.isModEvent: false for a plain click, else where to open ('tab', 'split', 'window', or true). */
	where(evt: MouseEvent): string | boolean;
}

/** Click and middle-click on a link in `container` open it, as in a note. Returns the unbinder. */
export function bindCellLinks(container: HTMLElement, sourcePath: () => string, opener: CellLinkOpener): () => void {
	const handler = (evt: MouseEvent): void => {
		if (evt.defaultPrevented || (evt.button !== 0 && evt.button !== 1)) return;
		const link = linkAt(evt.target, container);
		if (!link) return;
		evt.preventDefault();
		if (link.kind === 'internal') opener.openInternal(link.href, sourcePath(), opener.where(evt));
		else opener.openExternal(link.href);
	};
	container.addEventListener('click', handler);
	container.addEventListener('auxclick', handler);
	return () => {
		container.removeEventListener('click', handler);
		container.removeEventListener('auxclick', handler);
	};
}
