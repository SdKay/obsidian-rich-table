/**
 * What moves when the table's layout changes, and in what order, decided in one place.
 *
 * Everything that follows the layout (the strips, the outer frame, the status bar, the frozen
 * cells, the scrollbar thumbs) used to hang its own observer on the table, each reading the geometry
 * and writing in its own turn, some at once and some a frame later. Which came first was down to the
 * order the browser delivered them in, and a fix for one kept moving the problem to another.
 *
 * Here the consumers say which phase they belong to and the phases run in a fixed order: what only
 * reads, then what writes without changing the layout, then what can change it, then the strip cells
 * are rebuilt. The rebuild waits while one of the cells is being dragged, since replacing it would take
 * it from under the pointer, and is done once when the drag is over.
 */
export type LayoutPhase = 'measure' | 'place' | 'reflow' | 'rebuild';

const ORDER: readonly LayoutPhase[] = ['measure', 'place', 'reflow', 'rebuild'];
/** Rounds in one call before giving up on a layout that keeps changing. */
const MAX_PASSES = 3;

export interface LayoutSyncOptions {
	/** A string that changes whenever a box the consumers read has moved or been resized. */
	signature: () => string;
	/** True while the user is dragging a strip cell. */
	isBusy: () => boolean;
	/** Runs `fn` just before the next paint. */
	nextFrame: (fn: () => void) => void;
}

export interface LayoutSync {
	register(phase: LayoutPhase, fn: () => void): () => void;
	/** Runs the phases unless the layout is as it was the last time, or `force` is set. */
	run(opts?: { force?: boolean }): void;
	/**
	 * For what happens many times in a frame (a column or row being dragged): asks for a round before the
	 * next paint, however often it is asked within the frame. What happens once per layout (the observer's
	 * own notification, which the browser has already merged) calls `run` directly instead, in the frame
	 * whose layout it reacts to.
	 */
	schedule(): void;
	/** Does the rebuild that was held back, once nothing is being dragged any more. */
	settle(): void;
}

export function createLayoutSync({ signature, isBusy, nextFrame }: LayoutSyncOptions): LayoutSync {
	const consumers = new Map<LayoutPhase, Set<() => void>>(ORDER.map(p => [p, new Set()]));
	let last: string | null = null;
	let running = false;
	let rebuildOwed = false;
	let frameAsked = false;
	// Ticks for ordering: when the frame was asked for, and when a round last placed things. A round that began after
	// the ask measured the layout the asker left, so the frame has nothing more to do.
	let clock = 0;
	let askedAt = 0;
	let placedAt = 0;

	const call = (phase: LayoutPhase): void => {
		for (const fn of Array.from(consumers.get(phase) ?? [])) {
			try { fn(); } catch (err) { console.error('[rich-table] layout consumer failed', err); }
		}
	};

	const run = (opts?: { force?: boolean }): void => {
		if (running) return;
		const now = signature();
		if (!opts?.force && now === last) return;
		running = true;
		placedAt = ++clock;
		try {
			// A phase can change the layout an earlier phase has just placed things for (the reflow phase
			// does, and so does a stylesheet still being applied), so the round is repeated, in the same
			// frame, until it leaves the layout as it found it.
			let before = now;
			for (let pass = 0; pass < MAX_PASSES; pass++) {
				for (const phase of ORDER) {
					if (phase === 'rebuild' && isBusy()) { rebuildOwed = true; continue; }
					call(phase);
				}
				const after = signature();
				last = after;
				if (after === before) break;
				before = after;
			}
		} finally {
			running = false;
		}
	};

	return {
		register(phase, fn) {
			consumers.get(phase)?.add(fn);
			return () => { consumers.get(phase)?.delete(fn); };
		},
		run,
		schedule() {
			if (frameAsked) return;
			frameAsked = true;
			askedAt = ++clock;
			nextFrame(() => {
				frameAsked = false;
				// The observer reports a changed box in the same frame, after the asker changed it: its round has
				// already placed everything for this layout. Only a change the observer cannot see (the inside of a
				// table that keeps its box) leaves the ask unmet, and then no round has begun since.
				if (placedAt > askedAt) return;
				run({ force: true });
			});
		},
		settle() {
			if (!rebuildOwed || isBusy() || running) return;
			rebuildOwed = false;
			running = true;
			try { call('rebuild'); } finally { running = false; }
		},
	};
}
