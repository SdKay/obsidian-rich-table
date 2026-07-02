<div align="center">

<img src="./docs/banner.png" alt="Rich Table" />

<p>
  <b>🔀 Merge &nbsp;·&nbsp; 🎨 Style &nbsp;·&nbsp; 🏷️ Type &nbsp;·&nbsp; 🔗 Wikilink &nbsp;·&nbsp; ↕️ Reorder</b>
</p>

<p>
  <a href="https://github.com/SdKay/obsidian-rich-table/releases/latest">
    <img src="https://img.shields.io/github/v/release/SdKay/obsidian-rich-table?style=flat-square&color=7c3aed" alt="Latest release" />
  </a>
  <a href="https://github.com/SdKay/obsidian-rich-table/releases">
    <img src="https://img.shields.io/github/downloads/SdKay/obsidian-rich-table/total?style=flat-square&color=brightgreen" alt="Total downloads" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/SdKay/obsidian-rich-table?style=flat-square" alt="License" />
  </a>
  <a href="https://obsidian.md">
    <img src="https://img.shields.io/badge/Obsidian-%3E%3D1.4.10-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian compatibility" />
  </a>
</p>

<p>
  <a href="#-why-rich-table">Why?</a> ·
  <a href="#-demo">Demo</a> ·
  <a href="#-format">Format</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-installation">Install</a> ·
  <a href="README_CN.md">中文</a>
</p>

<p>
  <img src="docs/wechat-qrcode.jpg" alt="WeChat public account" width="120" />
  <br/><sub>Follow on WeChat for more Obsidian plugins &amp; tools</sub>
</p>

</div>

> **Obsidian-only plugin.** The `rich-table` fenced code block is a custom Obsidian renderer — it will not display in standard Markdown editors, GitHub previews, or any non-Obsidian environment.

Rich, interactive tables for Obsidian — with **cell merges**, inline editing, wikilink autocomplete, typed columns, title & footer, drag-to-reorder, and more. Everything that native Obsidian tables and most community table plugins simply can't do.

---

## Why Rich Table?

Obsidian's built-in tables are plain GFM — no merges, no types, no interactive editing. Most community table plugins work around the same limitation. Rich Table takes a different approach: a dedicated fenced code block that gives you a **spreadsheet-like experience inside your notes**.

| Pain point | Native tables | Rich Table |
| --- | --- | --- |
| Cell merging (rowspan / colspan) | ✗ | ✓ |
| Inline click-to-edit | ✗ | ✓ |
| `[[wikilink]]` autocomplete in cells | ✗ | ✓ |
| Typed columns (status, priority…) | ✗ | ✓ |
| Per-cell style (bg, color, font size) | ✗ | ✓ |
| Table title & footer notes | ✗ | ✓ |
| Drag to reorder rows / columns | ✗ | ✓ |
| Add / hide / delete rows & columns | ✗ | ✓ |

---

## Demo

**1 · Quick start from template** — empty block → insert template → edit title

<!-- record: open empty rich-table block, click Insert template, single-click title to rename (~6s) -->
![Quick start demo](docs/demo-01-template.gif)

**2 · Merge cells** — drag-select → Merge in popup

<!-- record: drag across 3 cells, popup appears, click Merge, result visible (~6s) -->
![Merge cells demo](docs/demo-02-merge.gif)

**3 · Typed columns & cell style** — click to switch value, double-click to set bg / font size

<!-- record: click a task-status cell → pick "done", then double-click another cell → set bg color + size → Apply (~7s) -->
![Typed columns and style demo](docs/demo-03-style.gif)

**4 · Wikilink autocomplete** — `[[` triggers file suggest, `#` for headings

<!-- record: single-click a cell, type [[, select a file, type #, select a heading (~6s) -->
![Wikilink autocomplete demo](docs/demo-04-wikilink.gif)

**5 · Drag to reorder & row/column ops** — ⠿ handle + double-click menu

<!-- record: drag a row handle to reorder, then double-click a cell → insert row below (~6s) -->
![Reorder and ops demo](docs/demo-05-reorder.gif)

**6 · Title & footer** — click to edit inline, Shift+Enter for multi-line footer

<!-- record: click title to rename, click footer → add a second line with Enter → Shift+Enter to save (~6s) -->
![Title and footer demo](docs/demo-06-title-footer.gif)

---

## Format

````markdown
```rich-table
---
title: Project tracker
columns:
  - { name: Task,     width: 200 }
  - { name: Status,   type: task-status }
  - { name: Owner }
  - { name: Priority, type: priority, align: center }
merges:
  - A3:A4
styles:
  - { target: "1:1", bold: true, bg: "#e8f0fe" }
  - { target: "B*",  bg: "#e6f4ea" }
  - { target: "D2",  size: 14, color: "#c0392b" }
footer: "Updated weekly · click any cell to edit"
---
| Task     | Status  | Owner        | Priority |
| -------- | ------- | ------------ | -------- |
| Design   | done    | [[Alice]]    | high     |
| Build    | pending | [[teammate]] | medium   |
| Test     | todo    |              | low      |
| Deploy   | todo    |              | low      |
```
````

### Coordinate system

Excel-style, 1-indexed. Row 1 = header row.

| Notation | Meaning |
| -------- | ------- |
| `A1`     | Column A, row 1 (header) |
| `A1:B3`  | Cell range |
| `B*`     | Entire column B |
| `*2`     | Entire row 2 |
| `1:3`    | Row range |

---

## Features

### Title & footer
Add a table title above and notes below using YAML fields. Both support inline Markdown (bold, italic, wikilinks). Click either to edit inline.

```yaml
title: My Project Board
footer: "* estimates only · last updated 2025-01"
```

Multiple footer lines via YAML array. Shift+Enter adds a line break while editing.

### Cell merging
Define any rectangular merge region in YAML. During interactive editing, drag across cells and click **Merge** in the popup. The plugin automatically expands to the minimum valid bounding box if a new merge partially overlaps an existing one.

### Inline editing
Single-click any cell to open an inline editor. Supports plain text, wikilinks, bold/italic, and all inline Markdown. `Enter` saves; `Escape` cancels.

### Wikilink autocomplete
Type `[[` inside any cell editor to trigger Obsidian's native file suggest:
- `[[filename` — file search
- `[[filename#heading` — heading links
- `[[filename#^blockid` — block references
- `[[filename|alias` — link aliases

### Typed columns
Attach a type to any column. Values render as colored pill badges. Single-click a cell to choose from the dropdown — no typing needed.

**Built-in types:**

| Type | Values |
| ---- | ------ |
| `task-status` | todo · pending · done · cancel |
| `priority` | high · medium · low |
| `boolean` | yes · no |
| `rating` | ★ through ★★★★★ |
| `effort` | XS · S · M · L · XL |
| `approval` | approved · pending · rejected |

Custom types can be defined in **Settings → Rich Table**.

### Double-click panel
Double-clicking any cell (or right-clicking a header) opens a unified panel with three sections:

1. **Cell operations** — insert/delete/hide rows & columns; unmerge merged cells. For merged cells the range covers all spanned rows/columns automatically.
2. **Style** — set background color, text color, and font size with live preview. Cancel to restore; Apply to persist. Clear format removes all cell-level styles.
3. **Change type** — header cells only; cascading submenu to switch the column type.

**Ctrl+drag** to select a range without opening the panel (for visual inspection). When the popup does appear after dragging, it also shows **Merge cells** as the first action.

### Style rules
Apply styles in YAML to any target: single cells, ranges, entire rows, or columns.

```yaml
styles:
  - { target: "1:1",   bold: true, bg: "#f0f4ff" }
  - { target: "B*",    bg: "#e6f4ea" }
  - { target: "A2:A5", color: "#555", size: 13 }
```

Supported properties: `bg`, `color`, `bold`, `italic`, `size` (px).

### Drag to reorder
Six-dot drag handles appear on hover — top of header cells for columns, left side of data cells for rows. Merge regions fully contained within the moved row/column travel with it; cross-boundary merges stay in place.

### Edge strips
Hover near the bottom edge of the table to reveal a **+** strip for appending a new row. Hover near the right edge to append a new column.

---

## Installation

1. Open **Settings → Community plugins → Browse**.
2. Search for **Rich Table** and install.
3. Enable the plugin.

Or install manually: copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/rich-table/`.

Minimum Obsidian version: **1.4.10**

---

## License

Free for **non-commercial use** under the [Polyform Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) license.

For **commercial use**, contact: sdkxyx@gmail.com

## Support & feedback

Issues and feature requests: [GitHub Issues](https://github.com/SdKay/obsidian-rich-table/issues)

---

## Known issues

- **Hidden column indicator width**: the `▶N` indicator column expands to fill available space in some themes due to theme CSS overriding `width` on `th` elements.

## Planned

- **Row-direction tables** (`direction: row`): attach types to rows instead of columns.
- **Custom choice type UI**: visual add/remove UI for custom types, replacing the raw-JSON textarea.

---

## Development

```bash
npm install
npm run dev        # watch mode — rebuilds on change
npm run build      # production build (tsc + minified main.js)
npm run lint       # ESLint with obsidianmd rules
```

Deploy to vault after build:

```bash
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/rich-table/"
```

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-rich-table&type=Date)](https://star-history.com/#SdKay/obsidian-rich-table&Date)
