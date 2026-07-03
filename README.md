<div align="center">

<img src="./docs/banner.png" alt="Rich Table" />

<p>
  <b>🔀 Merge &nbsp;·&nbsp; 🎨 Style &nbsp;·&nbsp; 🏷️ Type &nbsp;·&nbsp; 🔗 Wikilink &nbsp;·&nbsp; ↕️ Reorder &nbsp;·&nbsp; ↔️ Resize</b>
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
  <a href="https://obsidian.md/plugins?id=rich-table">
    <img src="https://img.shields.io/badge/Obsidian-Community_Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian community plugin" />
  </a>
</p>

<p>
  <a href="#why-rich-table">Why?</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#format">Format</a> ·
  <a href="#features">Features</a> ·
  <a href="#installation">Install</a> ·
  <a href="README_CN.md">中文</a>
</p>

<p>
  <img src="docs/wechat-qrcode.jpg" alt="WeChat public account" width="120" />
  <br/><sub>Follow on WeChat for more Obsidian plugins &amp; tools</sub>
</p>

</div>

> **Obsidian only.** The `rich-table` fenced code block is rendered by the plugin — it won't display in standard Markdown editors or GitHub previews.

Rich, interactive tables for Obsidian — with cell merges, inline editing, wikilink autocomplete, typed columns, drag-to-reorder, and more.

---

## Why Rich Table?

| Feature | Native tables | Rich Table |
| --- | --- | --- |
| Cell merging | ✗ | ✓ |
| Click-to-edit cells inline | ✗ | ✓ |
| `[[wikilink]]` autocomplete in cells | ✗ | ✓ |
| Typed columns (status, priority…) | ✗ | ✓ |
| Per-cell style (bg color, font size…) | ✗ | ✓ |
| Table title & footer notes | ✗ | ✓ |
| Drag to reorder rows / columns | ✗ | ✓ |
| Drag to resize column width / row height | ✗ | ✓ |
| Insert / hide / delete rows & columns | ✗ | ✓ |

---

## Demo

**1 · Quick start from template**

![Quick start demo](docs/demo-01-template.gif)

**2 · Merge cells** — drag-select → Merge in popup

![Merge cells demo](docs/demo-02-merge.gif)

**3 · Typed columns & cell style** — click to pick value, double-click to set style

![Typed columns and style demo](docs/demo-03-style.gif)

**4 · Drag to reorder & row/column ops** — ⠿ handle + double-click menu

![Reorder and ops demo](docs/demo-05-reorder.gif)

**5 · Drag to resize** — column header right edge · row bottom edge

![Resize demo](docs/demo-06-resize.gif)

**6 · Title & footer** — click to edit, Shift+Enter for multi-line

![Title and footer demo](docs/demo-07-title-footer.gif)

---

## Format

````markdown
```rich-table
---
title: Project tracker
columns:
  - { name: Task,   width: 200 }
  - { name: Status, type: task-status }
  - { name: Owner }
merges:
  - A3:A4
styles:
  - { target: "1:1", bold: true, bg: "#e8f0fe" }
footer: "Updated weekly · click any cell to edit"
---
| Task   | Status  | Owner     |
| ------ | ------- | --------- |
| Design | done    | [[Alice]] |
| Build  | pending | [[Bob]]   |
| Test   | todo    |           |
| Deploy | todo    |           |
```
````

The block starts with an optional YAML header (title, columns, merges, styles, footer), followed by a standard Markdown table grid.

**Coordinate notation** used in `merges` and `styles` targets:

| Notation | Meaning |
| -------- | ------- |
| `A1` | Cell — column A, row 1 (header) |
| `A2:B4` | Range |
| `B*` | Entire column B |
| `*3` | Entire row 3 |
| `2:4` | Row range |

---

## Features

**Editing**
- Single-click any cell to edit inline — supports plain text, `[[wikilinks]]`, bold, italic
- `[[` inside a cell triggers Obsidian's native file & heading autocomplete
- Double-click (or right-click a header) opens a panel to insert/delete/hide rows & columns, merge cells, set styles, or change the column type

**Typed columns**
Assign a type to a column; values render as colored pill badges. Single-click to pick from a dropdown — no typing needed.

Built-in types: `task-status` · `priority` · `boolean` · `rating` · `effort` · `approval`

Custom types can be defined in **Settings → Rich Table**.

**Styles**
Set background color, text color, and font size on any cell, row, column, or range — either via the double-click panel or directly in the YAML `styles` field.

**Merges**
Drag-select across cells and click **Merge** in the popup. Or declare merges in YAML (e.g. `A2:B3`).

**Reorder & resize**
- Drag the ⠿ handle on any header cell to reorder columns; drag the ⠿ handle on any data row to reorder rows.
- Drag a column header's right edge to resize its width; drag a row's bottom edge to resize its height.
- Hover near the table's bottom or right edge to reveal **+** strips for appending rows/columns.

**Title & footer**
Add a centered title above the table and notes below. Click either to edit inline. Multi-line footers supported.

---

## Installation

**Community plugin browser (recommended):**

1. Open **Settings → Community plugins → Browse**
2. Search for **Rich Table** and install
3. Enable the plugin

Or: [Open in Obsidian](https://obsidian.md/plugins?id=rich-table)

**Manual:** copy `main.js`, `manifest.json`, `styles.css` to `<vault>/.obsidian/plugins/rich-table/`

Minimum Obsidian version: **1.8.7**

---

## Planned

**Editing**
- Keyboard navigation — arrow keys to move between cells, Tab to advance
- Paste from clipboard — paste a copied Excel / CSV table directly into the grid

**Data & display**
- Row sorting — click a column header to sort
- Row filtering — show only rows matching a condition (e.g. `status = done`)
- Conditional formatting — auto-apply background color based on cell value rules
- Progress bar column type — visualize a 0–100 numeric value as a filled bar
- Aggregate row — automatic SUM / COUNT for numeric and choice columns

**Annotations**
- Cell comments — attach a floating note to any cell; shown on hover

**Structure**
- Row grouping — collapsible groups of rows
- Custom type editor — visual UI to add/edit choice types (replacing the JSON textarea)

---

## Claude Code Skill

A [`SKILL.md`](SKILL.md) is included for use with [Claude Code](https://claude.ai/code). Once installed, Claude agents can create and modify `rich-table` blocks directly in your vault — adding rows, applying styles, defining merges — without you having to remember the syntax.

```bash
cp SKILL.md ~/.claude/skills/rich-table/SKILL.md
```

Then ask Claude: *"Create a project tracker table in my note using rich-table"*.

---

## License

[AGPL-3.0](LICENSE) — derivatives must be open-sourced under the same license.

For **commercial licensing**: sdkxyx@gmail.com

## Feedback

Issues and feature requests: [GitHub Issues](https://github.com/SdKay/obsidian-rich-table/issues)

---

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-rich-table&type=Date)](https://star-history.com/#SdKay/obsidian-rich-table&Date)
