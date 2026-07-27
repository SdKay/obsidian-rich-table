/**
 * Generic factory for a small, cacheKey-keyed registry that carries a piece of
 * purely-local UI state across a write-back's full DOM teardown-and-rebuild.
 *
 * Every write-back rebuilds a table's DOM from scratch via a brand-new
 * `TableBlock` instance, constructed around a container Obsidian hands it —
 * the new instance has no way to reach into the previous instance's live DOM
 * (see the "Write-back architecture" note in CLAUDE.md). Anything that lives
 * only in the OLD instance's local state or DOM — an in-progress cell edit, a
 * hover strip's shown-ness, which month a calendar view is currently
 * displaying — would otherwise be silently destroyed and reset to some
 * default on every single structural edit, which reads as the UI "forgetting"
 * things a user just did seconds ago.
 *
 * The fix shape is always the same: the OLD instance records the fact at
 * write-back-trigger time (while its DOM/state is still live and directly
 * readable), keyed by `cacheKey` (the same key `renderCache` in tableBlock.ts
 * uses — stable per table across rebuilds); the NEW instance reads it back
 * once during its own render and restores. This factory is that shape, typed
 * per caller — used by renderEditHandoff.ts, renderHoverHandoff.ts, and the
 * calendar view's displayed-month memory (renderCalendar.ts), which were
 * three near-identical hand-written Map/register/take modules before this.
 */

interface HandoffOptions {
	/** Entries older than this (ms) are treated as absent on take() — a guard
	 *  against a leaked registration outliving its usefulness (e.g. the table
	 *  closes mid-edit and nothing ever consumes the registration), not a
	 *  timing budget for the handoff itself. Omit for state with no natural
	 *  staleness concept (a boolean flag, or "which month is displayed" has no
	 *  wrong answer to go stale). */
	maxAgeMs?: number;
}

export interface Handoff<T> {
	register(cacheKey: string, value: T): void;
	/** Removes the entry — optionally only if `guard` still matches its current
	 *  value, so a caller can't accidentally clear a DIFFERENT identity's
	 *  registration that overwrote this cacheKey's single slot in between (e.g.
	 *  cell A's save() firing after cell B already registered its own edit into
	 *  the same table's slot must not clear B's). Omit `guard` when a table only
	 *  ever holds one meaningful value at a time regardless of identity. */
	clear(cacheKey: string, guard?: (value: T) => boolean): void;
	/** Consumes (removes) and returns the entry if present, `guard`-matching
	 *  (if given), and not stale (if `maxAgeMs` configured) — otherwise `undefined`. */
	take(cacheKey: string, guard?: (value: T) => boolean): T | undefined;
}

export function createHandoff<T>(opts: HandoffOptions = {}): Handoff<T> {
	const entries = new Map<string, { value: T; registeredAt: number }>();

	return {
		register(cacheKey, value) {
			entries.set(cacheKey, { value, registeredAt: Date.now() });
		},
		clear(cacheKey, guard) {
			const entry = entries.get(cacheKey);
			if (entry && (!guard || guard(entry.value))) entries.delete(cacheKey);
		},
		take(cacheKey, guard) {
			const entry = entries.get(cacheKey);
			if (!entry) return undefined;
			if (guard && !guard(entry.value)) return undefined;
			entries.delete(cacheKey);
			if (opts.maxAgeMs !== undefined && Date.now() - entry.registeredAt > opts.maxAgeMs) return undefined;
			return entry.value;
		},
	};
}
