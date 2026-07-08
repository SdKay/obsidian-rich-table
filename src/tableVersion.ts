/**
 * Rich Table block-format versioning.
 *
 * CURRENT_TABLE_VERSION is the highest format version this build can parse.
 * Bump it (and add a migration function below) whenever a breaking syntax
 * change makes old source strings unparseable by the new parser.
 *
 * Consumers:
 *   - tableBlock.ts calls getTableVersion() before parsing.
 *   - If tableVersion > CURRENT → render an "upgrade plugin" banner.
 *   - If tableVersion < CURRENT → show an "upgrade table" banner;
 *     user clicks → migrateSource() runs → vault.process writes v2 → re-render.
 */

import { migrateV1toV2 } from './migrations/v1_to_v2';

export const CURRENT_TABLE_VERSION = 2;

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
 *   migrations[1]  v2 → v3  (add when needed)
 *   …
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
