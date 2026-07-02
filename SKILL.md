---
name: rich-table
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

## Block structure

````markdown
```rich-table
---
title: Optional table title
columns:
  - { name: Col A, width: 180 }
  - { name: Col B, type: task-status }
  - { name: Col C, type: priority, align: center }
merges:
  - A2:B3
styles:
  - { target: "1:1", bold: true, bg: "#e8f0fe" }
  - { target: "B*",  bg: "#e6f4ea" }
  - { target: "A2",  color: "#c0392b", size: 14 }
footer: "Optional footer note"
---
| Col A    | Col B   | Col C  |
| -------- | ------- | ------ |
| value 1  | done    | high   |
| value 2  | pending | low    |
```
````

The block has two sections separated by `---` lines:
1. **YAML frontmatter** — optional; defines columns, merges, styles, title, footer
2. **Markdown grid** — pipe-delimited rows; first row is the header, second row
   is the separator, remaining rows are data

If the block is completely empty, the plugin renders a built-in template.

---

## YAML fields

### `title` (string, optional)
Displayed above the table. Supports inline Markdown.
```yaml
title: "Q3 Project Tracker"
```

### `columns` (array, optional)
Each entry can have:

| Field    | Type | Default | Description |
| -------- | ---- | ------- | ----------- |
| `name`   | string | column letter | Column header text |
| `type`   | string | — | Built-in or custom choice type |
| `width`  | number | auto | Column width in px |
| `align`  | `left` \| `center` \| `right` | `center` | Text alignment |
| `hidden` | boolean | false | Hidden (collapsed) |

```yaml
columns:
  - { name: Task,     width: 200 }
  - { name: Status,   type: task-status }
  - { name: Priority, type: priority, align: center }
  - { name: Owner,    width: 120 }
```

### `merges` (array, optional)
Each entry is a cell range in Excel-style notation. Merges must be rectangular.
If two merges overlap, the plugin automatically expands to the minimum
bounding box.
```yaml
merges:
  - A2:A4        # span rows 2-4 in column A
  - C3:D5        # 2-column × 3-row merge
```

### `styles` (array, optional)
Each entry has a `target` and one or more style properties:

| Property | Type    | Description |
| -------- | ------- | ----------- |
| `target` | string  | Which cells to style (see coordinate system) |
| `bg`     | string  | Background color (CSS color string) |
| `color`  | string  | Text color (CSS color string) |
| `size`   | number  | Font size in px |
| `bold`   | boolean | Bold text |
| `italic` | boolean | Italic text |

```yaml
styles:
  - { target: "1:1",   bold: true, bg: "#e8f0fe" }
  - { target: "B*",    bg: "#e6f4ea" }
  - { target: "A2:A5", color: "#555", size: 13 }
  - { target: "C3",    bold: true, italic: true }
```

### `hiddenRows` (array of numbers, optional)
0-indexed row indices that are hidden. Row 0 is the header (never hidden).
Managed automatically by the plugin UI.
```yaml
hiddenRows:
  - 3
  - 4
```

### `footer` (string or array of strings, optional)
Displayed below the table. Supports inline Markdown. Use an array for multiple
lines.
```yaml
footer: "Last updated 2025-01"
# or multi-line:
footer:
  - "* Estimates only"
  - "Source: internal data"
```

---

## Coordinate system

Excel-style, **1-indexed**. Row 1 = header row. Column A = first column.

| Notation  | Meaning | Example use |
| --------- | ------- | ----------- |
| `A1`      | Single cell (col A, row 1) | Header of first column |
| `B3`      | Single cell (col B, row 3) | Second col, second data row |
| `A1:C3`   | Rectangular range | Rows 1-3, cols A-C |
| `B*`      | Entire column B | All rows in col B |
| `*2`      | Entire row 2 | First data row, all columns |
| `1:1`     | Row range (header only) | Just the header row |
| `2:5`     | Row range | Data rows 2-5 |

**Mapping between 1-indexed targets and 0-indexed model arrays:**
- Target row 1 = `model.rows[0]` (header)
- Target row 2 = `model.rows[1]` (first data row)
- Target col A = `model.columns[0]`
- Target col B = `model.columns[1]`

---

## Built-in column types

| Type ID       | Values (use the value string in grid cells) |
| ------------- | ------------------------------------------- |
| `task-status` | `todo` · `pending` · `in-progress` · `done` · `cancel` |
| `priority`    | `high` · `medium` · `low` |
| `boolean`     | `yes` · `no` |
| `rating`      | `1` ★ · `2` ★★ · `3` ★★★ · `4` ★★★★ · `5` ★★★★★ |
| `effort`      | `xs` · `s` · `m` · `l` · `xl` |
| `approval`    | `approved` · `pending` · `rejected` |
| `date`        | ISO date string `YYYY-MM-DD` (renders localised) |

Use the **value** (not the display label) in the grid cells.

---

## Grid format

```
| Header A | Header B | Header C |
| -------- | -------- | -------- |
| data     | done     | high     |
| data 2   | todo     | low      |
```

Rules:
- First non-separator row = column headers (order must match `columns`)
- Second row = separator (dashes only, ignored in rendering)
- Each subsequent row = one data row
- Cell count per row must equal `columns` length (pad with empty `|  |`)
- Pipe character `|` inside a cell value must be escaped as `\|`
- Whitespace around cell content is trimmed

**No YAML:** If there is no `---` frontmatter, the plugin infers columns from
the grid header row alone (no types, widths, or merges).

---

## Common patterns

### Minimal table (no YAML)
````markdown
```rich-table
| Name   | Role      | Team  |
| ------ | --------- | ----- |
| Alice  | Engineer  | Core  |
| Bob    | Designer  | UX    |
```
````

### Task board
````markdown
```rich-table
---
title: Sprint 12
columns:
  - { name: Task,   width: 220 }
  - { name: Status, type: task-status }
  - { name: Owner,  width: 120 }
  - { name: Due,    type: date }
styles:
  - { target: "1:1", bold: true, bg: "#f0f4ff" }
footer: "Sprint ends 2025-02-14"
---
| Task              | Status      | Owner   | Due        |
| ----------------- | ----------- | ------- | ---------- |
| Design mockups    | done        | [[Alice]] | 2025-01-10 |
| Backend API       | in-progress | [[Bob]]   | 2025-01-20 |
| Integration tests | todo        |         | 2025-01-28 |
```
````

### Merged header groups
````markdown
```rich-table
---
columns:
  - { name: Project, width: 180 }
  - { name: Q1,      align: center }
  - { name: Q2,      align: center }
  - { name: Q3,      align: center }
merges:
  - B1:D1
styles:
  - { target: "1:1", bold: true }
  - { target: "B1:D1", bold: true, bg: "#fff3cd" }
---
| Project   | Quarterly Revenue |  Q2   |  Q3   |
| --------- | ----------------- | ----- | ----- |
| Product A | $120k             | $140k | $160k |
| Product B | $80k              | $95k  | $110k |
```
````

### Highlighted cells with custom font size
````markdown
```rich-table
---
columns:
  - { name: Metric, width: 160 }
  - { name: Value,  align: center }
  - { name: Change, align: center }
styles:
  - { target: "1:1", bold: true, bg: "#1e293b", color: "#f1f5f9" }
  - { target: "B2",  size: 20, bold: true, color: "#16a34a" }
  - { target: "C2",  color: "#16a34a" }
  - { target: "B3",  size: 20, bold: true, color: "#dc2626" }
  - { target: "C3",  color: "#dc2626" }
---
| Metric  | Value  | Change |
| ------- | ------ | ------ |
| Revenue | $2.4M  | +12%   |
| Costs   | $1.8M  | +18%   |
```
````

---

## Creating a table in a vault note

1. Read the target file with `Read`
2. Identify the insertion point
3. Insert the fenced block using `Edit`

```
old_string: "## My Section\n\n"
new_string: "## My Section\n\n```rich-table\n---\ncolumns:\n  - { name: Task }\n  - { name: Status, type: task-status }\n---\n| Task | Status |\n| ---- | ------ |\n|      | todo   |\n```\n\n"
```

## Modifying an existing table

1. Read the file and locate the ` ```rich-table ` block
2. Edit the YAML frontmatter or grid rows as needed
3. Write back with `Edit`

**Add a row:** append `| val | val |` after the last data row.

**Add a column:**
- Add `- { name: NewCol }` to `columns:` in YAML
- Append `| NewHeader |` to the header row
- Append `| --- |` to the separator row
- Append `|  |` to every data row

**Apply a style:** add an entry to `styles:` in the YAML frontmatter.

**Merge cells:** add an entry to `merges:` (e.g. `- A2:A4`). The merge origin
cell (top-left) should hold the content; covered cells can be left empty.
