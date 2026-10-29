import type { MatchOptions, OpenedHit, RichSearchHostApi } from './richSearchApi';

/** Quick typing in the search box changes the query on every key; marking a big table takes 100 ms or more. */
export const PANEL_DEBOUNCE_MS = 80;

/**
 * What changed: the search itself (re-mark; waits for typing to pause), only which match is opened (move the bright one; at once),
 * or which files the search covers (re-mark at once; the query may be the same).
 */
export type PanelChange = 'query' | 'hit' | 'scope';

export type PanelState =
	| { kind: 'none' }
	| { kind: 'unknown' }
	| { kind: 'query'; query: MatchOptions };

/**
 * Follows the Rich Search panel for everything that marks matches (the .xlsx tab and the tables in notes).
 * One listener on the host however many followers there are; each follower is told, once typing pauses,
 * that the query may have changed and reads it with `state()`. Pure of Obsidian: the host is handed in.
 */
export class SearchPanelFollower {
	private readonly followers = new Set<(change: PanelChange) => void>();
	private unsubscribers: (() => void)[] = [];
	private subscribedTo: RichSearchHostApi | null = null;
	private timer: number | null = null;

	constructor(private readonly getHost: () => RichSearchHostApi | undefined) {}

	/** The host when it speaks an apiVersion this plugin knows. One without `currentQuery` or `onQueryChange` simply says nothing. */
	private panelHost(): RichSearchHostApi | null {
		const host = this.getHost();
		return host && host.apiVersion === 1 ? host : null;
	}

	/** The Rich Search to match with, when it speaks an apiVersion this plugin knows. */
	host(): RichSearchHostApi | null {
		return this.panelHost();
	}

	/**
	 * What the panel holds right now. `unknown` is a Rich Search that predates `currentQuery`: it cannot say
	 * when a search ends, so the caller falls back to the query of the hit it was opened with.
	 */
	state(): PanelState {
		const host = this.panelHost();
		if (!host) return { kind: 'none' };
		if (!host.currentQuery) return { kind: 'unknown' };
		try {
			const q = host.currentQuery();
			return q && q.query !== '' ? { kind: 'query', query: q } : { kind: 'none' };
		} catch {
			return { kind: 'none' };
		}
	}

	/** The match the user opened from the results, or null: none opened, no Rich Search, or one that predates `currentHit`. */
	hit(): OpenedHit | null {
		const host = this.panelHost();
		if (!host?.currentHit) return null;
		try {
			return host.currentHit() ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Whether the search covers this file (contract 5.11), asked with the path a view would give to `extract`.
	 * A missing Rich Search, one without `inScope` and a check that throws all count as covered.
	 */
	covers(path: string): boolean {
		const host = this.panelHost();
		if (typeof host?.inScope !== 'function') return true;
		try {
			return host.inScope(path) !== false;
		} catch {
			return true;
		}
	}

	/** Calls `listener` after the panel's query changes (once typing pauses) or the opened match changes (at once). Returns the function that stops it. */
	follow(listener: (change: PanelChange) => void): () => void {
		this.followers.add(listener);
		this.connect();
		return () => {
			this.followers.delete(listener);
			if (this.followers.size === 0) this.disconnect();
		};
	}

	/** Re-checks the host: Rich Search may have been enabled, disabled or replaced since the last look. */
	connect(): void {
		if (this.followers.size === 0) return;
		const host = this.panelHost();
		if (host === this.subscribedTo) return;
		this.drop();
		if (!host) return;
		try {
			if (host.onQueryChange) this.unsubscribers.push(host.onQueryChange(() => this.schedule()));
			if (host.onHitChange) this.unsubscribers.push(host.onHitChange(() => this.tell('hit')));
			this.subscribedTo = host;
		} catch {
			this.drop();
			return;
		}
		// Without inScope a scope change has nothing new to read, so onScopeChange alone is ignored.
		try {
			if (host.inScope && host.onScopeChange) this.unsubscribers.push(host.onScopeChange(() => this.tell('scope')));
		} catch { /* the query and the opened match are still followed */ }
	}

	private schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.tell('query');
		}, PANEL_DEBOUNCE_MS);
	}

	private tell(change: PanelChange): void {
		for (const f of [...this.followers]) f(change);
	}

	private drop(): void {
		for (const stop of this.unsubscribers) {
			try { stop(); } catch { /* a host that fails to unsubscribe is already gone */ }
		}
		this.unsubscribers = [];
		this.subscribedTo = null;
	}

	private disconnect(): void {
		this.drop();
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}
}
