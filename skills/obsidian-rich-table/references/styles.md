# Style target reference

How `styles[].target` selects cells and how rules cascade.

## Style target reference (v2)

| Target | Meaning |
|--------|---------|
| `header` | Entire header row |
| `header.c_xxx` | Single header cell (column `c_xxx`) |
| `r_xxx` | Entire data row |
| `c_xxx` | Entire column, including header |
| `r_aaa:r_bbb` | Row range |
| `c_aaa:c_bbb` | Column range |
| `r_aaa.c_aaa:r_bbb.c_bbb` | Rectangle range |
| `r_xxx.c_yyy` | Single data cell |

**Cascade priority** (lower wins first, higher overrides):
1. Whole row / whole column (`r_xxx`, `c_xxx`)
2. Row range / column range (`r_aaa:r_bbb`, `c_aaa:c_bbb`)
3. Rectangle range (`r_aaa.c_aaa:r_bbb.c_bbb`)
4. Single cell (`r_xxx.c_yyy`, `header.c_xxx`)

Per-attribute merge — a cell rule only overrides the properties it explicitly sets.

`align` has one extra fallback below all of these: if no matching `styles[]` rule sets `align` for a cell, it falls back to that cell's own column's `align` field (`columns[].align`) instead of being left unset — set `columns[].align` for a column-wide default, and only add an `align` style rule to override it for specific cells.
