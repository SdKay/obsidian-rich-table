# Workbooks and .xlsx-backed tables

Multi-sheet blocks (`version: 3`) and tables backed by an external `.xlsx` file.

### `sheets` and `active_sheet` (workbook, `version: 3`)
A workbook holds several tables ("sheets") in one block, shown as tabs in the status bar. Use it only when the user wants multiple tabs; a single table stays `version: 2`.

| Field | Where | Description |
| ----- | ----- | ----------- |
| `title` | top level | Optional workbook title |
| `active_sheet` | top level | ID of the sheet shown first; unknown IDs fall back to the first sheet |
| `sheets` | top level | Array of sheets |
| `id` | sheet | Stable sheet ID, e.g. `s_000000` |
| `name` | sheet | Tab label |
| `tabColor`, `tabTextColor` | sheet | Optional tab background and text colors |
| everything else | sheet | Any field of a single table (`columns`, `rows`, `merges`, `styles`, `freezeRows`, `viewWidth`, `zoom`, …); each sheet has its own |

```yaml
---
version: 3
active_sheet: s_000000
sheets:
  - id: s_000000
    name: Q1
    columns:
      - id: c_000000
        name: Item
    rows:
      - id: r_000000
        cells:
          c_000000: Rent
  - id: s_000001
    name: Q2
    tabColor: "#e8f0fe"
    columns:
      - id: c_000000
        name: Item
    rows: []
---
```

### `xlsxSource` (object, optional)
Backs this table with an external `.xlsx` file instead of the block's own data — **view-only**, and mutually exclusive with authoring real `columns`/`rows` content (when this field is present, ignore/omit `columns`/`rows` entirely; the plugin discards them on every read anyway).

| Field   | Type | Description |
| ------- | ---- | ----------- |
| `path`  | string | Path to the `.xlsx` file, resolved the same way a wikilink target is (relative to the note, or a full vault path) |
| `sheet` | string | Optional — show just this one sheet. Omitted: shows every sheet as a workbook, or the single sheet if the file only has one |

```yaml
---
version: 2
xlsxSource:
  path: data/budget.xlsx
---
```

Everything else about the block (`title`, `footer`, `theme`, `viewWidth`, `viewHeight`, …) still works normally alongside `xlsxSource` — those are genuine fields of this block; only `columns`/`rows`/`merges`/`styles` are meaningless here (real content comes from the file). Do not hand-author `columns`/`rows` on an `xlsxSource` block — they are silently discarded on every read, so there's no reason to write them, and the plugin's own writes never include them either.

Known gaps (view-only phase 1): no formula engine (formula cells show their last-saved value only); theme-relative/indexed colors, cell borders and number formats aren't carried over; rich-text runs are flattened to plain text.
