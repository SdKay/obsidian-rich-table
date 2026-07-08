/**
 * ID generation for Rich Table v2.
 *
 * Two flavours:
 *  - genId()  — random, for new rows/columns created at runtime.
 *  - seqId()  — sequential, for migrations (pure-function / reproducible).
 */

/** Runtime: random 6-char base36 ID, guaranteed unique within `existing`. */
export function genId(prefix: 'c' | 'r', existing: Set<string>): string {
	let id: string;
	do {
		id = `${prefix}_${Math.random().toString(36).slice(2, 8).padStart(6, '0')}`;
	} while (existing.has(id));
	existing.add(id);
	return id;
}

/** Migration: sequential ID based on position (c_000000, r_000001, …).
 *  Using seqId keeps migrateV1toV2 a pure function — same input → same output. */
export function seqId(prefix: 'c' | 'r', index: number): string {
	return `${prefix}_${String(index).padStart(6, '0')}`;
}
