/**
 * ID generation for Rich Table v2.
 *
 * Random 6-char base36 ids for rows, columns, views and sheets.
 */

/** Runtime: random 6-char base36 ID, guaranteed unique within `existing`. */
export function genId(prefix: 'c' | 'r' | 'v' | 's', existing: Set<string>): string {
	let id: string;
	do {
		id = `${prefix}_${Math.random().toString(36).slice(2, 8).padStart(6, '0')}`;
	} while (existing.has(id));
	existing.add(id);
	return id;
}
