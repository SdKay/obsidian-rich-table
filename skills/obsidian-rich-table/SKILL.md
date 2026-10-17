---
name: obsidian-rich-table
description: >
  Create, read, and modify rich-table fenced code blocks in Obsidian vault notes.
  Use this skill whenever the user asks to create a table, add rows or columns,
  apply styles, merge cells, set column types, add a title or footer, or otherwise
  work with the rich-table plugin format. Also use when reading or analysing
  existing rich-table blocks in vault files.
---

# Rich Table — Agent Reference

`rich-table` is an Obsidian plugin that renders rich interactive tables inside
fenced code blocks. This skill covers everything an agent needs to create and
modify these tables in Markdown files.

> **Obsidian-only.** The `rich-table` block will not render in standard
> Markdown editors or GitHub previews.

---

## Block structure (v2 format)

````markdown
```rich-table
---
version: 2
title: Optional table title
columns:
  - id: c_000000
    name: Task
    width: 220
  - id: c_000001
    name: Status
    type: task-status
    width: 110
  - id: c_000002
    name: Owner
    width: 120
rows:
  - id: r_000000
    cells:
      c_000000: Design architecture
      c_000001: done
      c_000002: "[[Alice]]"
  - id: r_000001
    cells:
      c_000000: Build API
      c_000001: in-progress
      c_000002: "[[Bob]]"
merges:
  - anchor: r_000000.c_000000
    end: r_000001.c_000000
styles:
  - target: header
    bold: true
    bg: "#e8f0fe"
  - target: r_000000.c_000001
    bg: "#f0fdf4"
footer: "Updated weekly · click any cell to edit"
---
```
````

**Structure rules:**
- The **YAML front-matter is the entire block** — everything the table needs lives between the two `---` lines. There is nothing below the closing `---` to write or maintain (an older note may still have a read-only pipe-table mirror left over from before that was removed from the format; harmless, ignore it, don't add one to a new block).
- `version: 2` is required for the current format.
- Columns and rows each have a stable `id` field. Use sequential IDs: `c_000000`, `c_000001`, … for columns and `r_000000`, `r_000001`, … for rows.
- Cell values are stored in `rows[].cells` as a record keyed by column ID.

---

## YAML fields

### `version` (number, required)
`2` for a single table. `3` for a multi-sheet workbook (see [workbook-and-xlsx.md](references/workbook-and-xlsx.md)). Never write any other value.

### `title` (string, optional)
Displayed above the table. Supports inline Markdown.

### `columns` (array)
Each entry has:

| Field    | Type | Default | Description |
| -------- | ---- | ------- | ----------- |
| `id`     | string | — | Stable ID, e.g. `c_000000` |
| `name`   | string | — | Column header text |
| `type`   | string | — | Built-in or custom choice type ([cell-content.md](references/cell-content.md)) |
| `width`  | number | auto | Column width in px |
| `align`  | `left` \| `center` \| `right` | — | Text alignment |
| `hidden` | boolean | false | Hidden (collapsed) column |
| `filter` | array of strings | — | Values to SHOW for this column (row filtering). Managed automatically by the plugin UI. |

```yaml
- id: c_000001
  name: 状态
  filter:
    - done
    - in-progress
```

Summary/aggregate rows are **not** a per-column field — see the top-level
`aggregate` field ([view-and-display.md](references/view-and-display.md)).

> **Quote column names containing YAML special characters.**  
> Characters `[ ] { } : , #` need double-quoting:
> ```yaml
> - id: c_000000
>   name: "rx_buf[] type"   # ✅
> ```

### `rows` (array)
Each entry has:

| Field      | Type | Description |
| ---------- | ---- | ----------- |
| `id`       | string | Stable ID, e.g. `r_000000` |
| `cells`    | object | Map of column-id → cell content string. Sparse — a missing colId key means an empty cell, never an error; the parser must not require every column to be present. |
| `formulas` | object | Map of column-id → formula string for cells computed from a formula instead of typed directly — see [formulas.md](references/formulas.md). Sibling of `cells`, not nested inside it. |
| `hidden`   | boolean | Row is hidden (collapsed) |
| `height`   | number | Forced row height in px |

Omit keys for empty cells (sparse storage). Multi-line cell content uses YAML block scalar `|-`:

```yaml
  - id: r_000002
    cells:
      c_000000: |-
        - First item
        - Second item
        - Third item
      c_000001: todo
```

### `merges` (array, optional)
Each entry is a rectangle identified by anchor (top-left) and end (bottom-right) cells:

```yaml
merges:
  - anchor: r_000000.c_000000
    end:    r_000002.c_000000
  - anchor: r_000001.c_000002
    end:    r_000002.c_000003
```

The anchor cell holds the displayed content; covered cells should have empty or omitted values.

A merge can also anchor in the header and extend down into data rows (`anchor: header.c_000000`, `end: r_000001.c_000000`) — the header row participates in merges exactly like a data row, using the literal `header` sentinel in place of a row ID.

### `styles` (array, optional)
Each entry has a `target` and one or more style properties:

| Property | Type    | Description |
| -------- | ------- | ----------- |
| `target` | string  | Which cells to style ([references/styles.md](references/styles.md)) |
| `bg`     | string  | Background color (CSS color string) |
| `color`  | string  | Text color (CSS color string) |
| `size`   | number  | Font size in px |
| `bold`   | boolean | Bold text |
| `italic` | boolean | Italic text |
| `align`  | `left` \| `center` \| `right` | Text alignment for this target — overrides the column's own `align` field (see `columns` above) for just these cells |

```yaml
styles:
  - target: header
    bold: true
    bg: "#e8f0fe"
  - target: c_000001
    bg: "#e6f4ea"
  - target: r_000000.c_000002
    color: "#c0392b"
    size: 14
  - target: r_000000.c_000003
    align: center
```

### `footer` (string or array of strings, optional)
Displayed below the table. Supports inline Markdown. Use an array for multiple lines.

```yaml
footer: "Last updated 2025-01"
# or multi-line:
footer:
  - "* Estimates only"
  - "Source: internal data"
```

### Other fields

These fields are all optional and documented in separate files. When the user's request involves one, read its file first; do not guess its syntax.

| Field(s) | Reference |
| -------- | --------- |
| `formulas` (computed cells, `=SUM(...)`, error values) | [references/formulas.md](references/formulas.md) |
| `theme`, `locked`, `collapsed`, `sort`, `aggregate`, `freezeRows`/`freezeCols`, `viewWidth`/`viewHeight`, `zoom`, `statusBarMode`, `statusBarScrollWidth`, `views`/`activeViewId` | [references/view-and-display.md](references/view-and-display.md) |
| `sheets`/`active_sheet` (multi-sheet, `version: 3`), `xlsxSource` | [references/workbook-and-xlsx.md](references/workbook-and-xlsx.md) |
| `styles[].target` grammar and cascade | [references/styles.md](references/styles.md) |
| What a cell may contain (Markdown, math, nested tables), built-in column `type` values | [references/cell-content.md](references/cell-content.md) |
| Complete example blocks | [references/examples.md](references/examples.md) |
| Built-in themes | [references/themes.md](references/themes.md) |

---

## Creating a table in a vault note

1. Read the target file with `Read`
2. Identify the insertion point
3. Insert the fenced block using `Edit` — the YAML front-matter is the whole block, nothing else needed below the closing `---`

## Modifying an existing table

**Prefer the bundled tool.** It applies the same operations the plugin itself uses, so ids stay unique, a deleted row or column takes its merges and styles with it, formulas are recomputed and a merge never overlaps another. Hand-editing the YAML bypasses all of that. Read the table (this document is enough), but write through the tool; it needs only Node 18+.

```bash
node scripts/rich-table.cjs list  note.md                  # which blocks the note has
node scripts/rich-table.cjs show  note.md --block 0        # the parsed table as JSON, with every row and column id
node scripts/rich-table.cjs apply note.md --block 0 --op '<json>' [--dry-run]
```

`--op` is one operation or a JSON array applied in order. Take ids from `show`; never invent them. Only the chosen block is rewritten, the rest of the note is left byte-for-byte. Common operations:

```json
{"type":"insert-row","afterRowId":null}
{"type":"delete-row","rowId":"r_000001"}
{"type":"insert-col","afterColId":"c_000000"}
{"type":"set-cell-content","rowId":"r_000000","colId":"c_000001","value":"done"}
{"type":"set-col-name","colId":"c_000001","name":"Status"}
{"type":"set-col-type","colId":"c_000001","colType":"task-status"}
{"type":"merge-cells","anchorRowId":"r_000000","anchorColId":"c_000000","endRowId":"r_000001","endColId":"c_000000"}
{"type":"fill-cells","cells":[{"rowId":"r_000000","colId":"c_000000"},{"rowId":"r_000001","colId":"c_000000"}],"values":["1","2"]}
```

For a multi-sheet table add `"sheetId"` to target a sheet other than the active one. The full list of operation types is the `StructuralOpV2` union in the plugin source (`src/operations.ts`); an unknown or malformed operation is reported as an error and nothing is written. Use `--dry-run` first when unsure: it prints the whole note instead of saving it.

### Editing by hand

Only when the tool cannot run, or to create a brand-new block:

1. Read the file and locate the ` ```rich-table ` block
2. Edit the YAML front-matter (ignore any trailing content below the closing `---` — an old note may still have a legacy pipe-table mirror there; the parser never reads it, and it's fine to leave it as-is)
3. Write back with `Edit`

**Add a row:** append a new entry to `rows[]` with the next sequential `id` (`r_000003`, etc.) and appropriate `cells`.

**Add a column:** append to `columns[]` with the next sequential `id` (`c_000003`, etc.); add the corresponding key to each row's `cells` that needs a value.

**Apply a style:** add or update an entry in `styles[]` using [references/styles.md](references/styles.md).

**Merge cells:** add an entry to `merges[]` with `anchor: rowId.colId` and `end: rowId.colId`. Ensure the anchor cell has the content and covered cells are empty.

**Remove a row/column:** delete the entry from `rows[]` / `columns[]` and remove any references to its ID from `merges[]` and `styles[]`.
