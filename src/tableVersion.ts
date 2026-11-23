/**
 * The highest block-format version this build reads. A block written with a
 * higher one is refused with a banner, never half-parsed.
 *
 * 2 is a single table, 3 a multi-sheet workbook. A table becomes 3 only when
 * the user adds a second sheet; a 2 is never asked to upgrade.
 */
export const CURRENT_TABLE_VERSION = 3;
