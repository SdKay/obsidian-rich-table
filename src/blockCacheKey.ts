/**
 * The cacheKey a `rich-table` code block mount uses to find/leave state for
 * its OWN next/previous instance across a write-back rebuild (renderCache,
 * and the hover/edit/selection/calendar handoffs — see tableBlock.ts).
 *
 * `ctx.getSectionInfo(el)` only resolves a line range for a genuine top-level
 * section of the real file. A `rich-table` block rendered INSIDE a cell of
 * another one (MarkdownRenderer.render recursing into this same processor for
 * a nested ```rich-table``` fence) isn't one — `info` comes back `null` for
 * it every time, with nothing distinguishing one nested occurrence from
 * another. Falling back to the bare sourcePath in that case makes EVERY
 * nested table in the same note share one cacheKey — a fact/snapshot
 * registered by any one of them (or by an earlier render of the very same
 * one) gets handed to whichever nested table renders next, regardless of
 * whether it actually applies — reported as a nested table's selector strips
 * and left toolbar staying permanently visible (with the padding it reserves
 * for them showing as blank space above its own content) even though nothing
 * nearby was actually hovered.
 *
 * The fix is a per-mount-unique fallback key: every lookup on it then simply
 * misses, which is the correct behaviour here (there is no stable identity to
 * hand off between one nested mount and the next), rather than colliding with
 * an unrelated nested table's leftover state. This does cost nested tables
 * the cross-rebuild continuity a stable key buys top-level tables (hover
 * restore, the live-DOM placeholder, edit resume) — accepted, not fixed,
 * since there's no real per-position identity available to key by. A
 * top-level table is unaffected: `info` is never null for one.
 */
export function computeCacheKey(sourcePath: string, info: { lineStart: number } | null, randomSuffix: () => string): string {
	return info ? `${sourcePath}:${info.lineStart}` : `${sourcePath}:nested-${randomSuffix()}`;
}

/** The marker computeCacheKey's nested branch always includes — tableBlock.ts
 *  checks for this to know its own cacheKey will never be reused, and so must
 *  be actively cleaned up on unload rather than left for a same-key successor
 *  to read (see its constructor). */
export const NESTED_CACHE_KEY_MARKER = ':nested-';
