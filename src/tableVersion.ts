/**
 * Rich Table block-format versioning.
 *
 * CURRENT_TABLE_VERSION is the highest format version this build can parse.
 * Bump it whenever a NEW format shape is introduced, even one that isn't a
 * forced migration (see MIN_STABLE_VERSION below for why v3 is exactly this).
 *
 * Consumers:
 *   - tableBlock.ts calls getTableVersion() before parsing.
 *   - If tableVersion > CURRENT → render an "upgrade plugin" banner (this
 *     table was written by a newer plugin build than the one currently
 *     installed — refuse to parse rather than risk misreading it).
 *   - If tableVersion < MIN_STABLE_VERSION → show an "upgrade table" banner;
 *     user clicks → migrateSource() runs → vault.process writes → re-render.
 *
 * MIN_STABLE_VERSION is DELIBERATELY LOWER than CURRENT_TABLE_VERSION as of
 * v3 (multi-sheet workbooks) — the two numbers answer different questions
 * and must not be conflated:
 *   - CURRENT_TABLE_VERSION: "the highest format shape this build understands."
 *   - MIN_STABLE_VERSION: "the lowest format below which a table is
 *     considered outdated and gets nagged to convert."
 * v1→v2 was a genuine forced migration (v1's Excel-notation/positional
 * format was a real, structural downgrade users should move off of) — that
 * relationship is "< CURRENT means outdated," which is why the two constants
 * used to be the same number. v2→v3 is NOT that kind of relationship: a
 * single-sheet v2 table is not deficient, it just doesn't have sheets — v3
 * is an opt-in envelope a table only adopts when the user explicitly adds a
 * second sheet (see workbookOperations.ts's `create-sheet`), never something
 * an existing v2 table should be nagged to "upgrade" to on open. Keeping
 * MIN_STABLE_VERSION at 2 while CURRENT_TABLE_VERSION moves to 3 means every
 * existing v2 table keeps rendering/editing exactly as before — no banner,
 * no read-only period — while a v3 file opened in an OLDER (pre-sheets)
 * plugin build still correctly shows THAT build's own "too new, please
 * upgrade the plugin" banner (that check only ever depends on the older
 * build's own hardcoded CURRENT_TABLE_VERSION, unaffected by this file).
 */

import { migrateV1toV2 } from './migrations/v1_to_v2';

export const CURRENT_TABLE_VERSION = 3;
export const MIN_STABLE_VERSION = 2;

/** Extract the format version from a rich-table source string.
 *  Returns 1 if the version field is absent (all pre-versioning tables). */
export function getTableVersion(source: string): number {
	const lines = source.split('\n');
	if (lines[0]?.trim() !== '---') return 1; // no YAML front-matter
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') break;
		const m = /^version:\s*(\d+)/.exec(lines[i] ?? '');
		if (m) return parseInt(m[1] ?? '1');
	}
	return 1;
}

/** A migration function receives the raw block source at version N and returns
 *  the transformed source at version N+1 (including `version: <N+1>` in YAML).
 *  Must be a pure function (same input → same output). */
type MigrationFn = (source: string) => string;

/**
 * Migration chain indexed by FROM-version (0-based):
 *   migrations[0]  v1 → v2
 *   …
 *
 * Deliberately has NO v2 → v3 hop: reaching v3 (multi-sheet) is never a
 * generic "your table is outdated, convert it" migration — it only happens
 * via the explicit "add a second sheet" UI action (workbookOperations.ts),
 * which builds the `{ sheets: [...] }` wrapper directly rather than walking
 * this chain. `migrateSource` below still nominally loops up to
 * CURRENT_TABLE_VERSION, but since index 1 (v2→v3) has no function, the loop
 * silently stops after the v1→v2 hop — exactly the desired outcome: a real
 * v1 table upgrades to plain v2, never straight to a 1-sheet v3 workbook.
 *
 * Each function is self-contained and can be deleted once all tables on that
 * version have been migrated.
 */
const migrations: MigrationFn[] = [
	migrateV1toV2,   // index 0: v1 → v2
];

/** Apply all available migrations from fromVersion up to CURRENT_TABLE_VERSION.
 *  Returns the migrated source string. */
export function migrateSource(source: string, fromVersion: number): string {
	let result = source;
	for (let v = fromVersion; v < CURRENT_TABLE_VERSION; v++) {
		const fn = migrations[v - 1];
		if (fn) result = fn(result);
	}
	return result;
}
