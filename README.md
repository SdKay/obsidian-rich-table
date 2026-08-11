<div align="center">

<img src="./docs/banner.png" alt="Rich Table" />

<p>
  <b>🔀 Merge &nbsp;·&nbsp; 🏷️ Type &nbsp;·&nbsp; 🎨 Style &nbsp;·&nbsp; 🧊 Freeze &nbsp;·&nbsp; 🔽 Sort &amp; Filter &nbsp;·&nbsp; Σ Summary &nbsp;·&nbsp; 📑 Sheets &nbsp;·&nbsp; 🗂️ Kanban &nbsp;·&nbsp; 📅 Calendar &nbsp;·&nbsp; 🔗 Wikilink &nbsp;·&nbsp; 📐 Math</b>
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
  <a href="https://paypal.me/ssdking">
    <img src="https://img.shields.io/badge/Donate-PayPal-003087?style=flat-square&logo=paypal&logoColor=white" alt="Donate via PayPal" />
  </a>
</p>

<p>
  <a href="#installation">Install</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#keyboard">Keyboard</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#features--roadmap">Features</a> ·
  <a href="#format">Format</a> ·
  <a href="README_CN.md">中文</a>
</p>

<p>
  <img src="docs/wechat-qrcode.jpg" alt="WeChat public account" width="120" />
  <br/><sub>Follow on WeChat for more Obsidian plugins &amp; tools</sub>
</p>

</div>

> **Obsidian only.** The `rich-table` fenced code block is rendered by the plugin — it won't display in standard Markdown editors or GitHub previews.

Rich, interactive tables for Obsidian — with cell merges, inline editing, wikilink autocomplete, typed columns, drag-to-reorder, math formulas, lists, images, and more.

---

## Why Rich Table?

| Feature | Native tables | Rich Table |
| --- | --- | --- |
| Cell merging | ✗ | ✓ |
| Click-to-edit cells inline | ✗ | ✓ |
| `[[wikilink]]` autocomplete in cells | ✗ | ✓ |
| Math formulas (KaTeX) in cells | ✗ | ✓ |
| Lists, bold, italic, links, images in cells | ✗ | ✓ |
| Multi-line cell content | ✗ | ✓ |
| Typed columns (status, priority…) | ✗ | ✓ |
| Per-cell style (bg color, font size…) | ✗ | ✓ |
| Column alignment (left / center / right) | ✗ | ✓ |
| Table title & footer notes | ✗ | ✓ |
| Drag to reorder rows / columns | ✗ | ✓ |
| Drag to resize column width / row height | ✗ | ✓ |
| Insert / hide / delete rows & columns | ✗ | ✓ |
| Row filtering by value | ✗ | ✓ |
| Per-table lock | ✗ | ✓ |

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

## Demo

> **⬆️ Upgrading from v0.x?** — v1 → v2 migration: the upgrade banner on old-format tables, converting in one click or keeping the old format read-only.
>
> ![Upgrade](docs/demo-00-migration.gif)
**1 · Quick start from template — or a blank table**

An empty `rich-table` code block shows one button per built-in template (currently a full-featured **Demo** and a **Cornell Notes** layout) plus **Insert blank table**, which opens a Word/Sheets-style size picker — hover an 8×6 grid to preview and click to confirm a row/column count, or type exact numbers for anything past the visible grid. Hovering any button live-previews that option below; with nothing hovered, the default template previews. Templates are auto-discovered from `src/templates/*.yaml` (same pattern as themes) — no code changes needed to add one.

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

**7 · Column filtering** — filter rows to focus on what matters

![Column filtering demo](docs/demo-08-filter.gif)

**8 · Rich cell content** — math · bold/italic · links · images · lists · multi-line

> 🎬 *Demo GIF coming soon*

**9 · Copy/paste interop with Excel & Markdown** — paste values pasted from Excel/Sheets straight into a cell (detected via clipboard HTML); copy a selection out as an Excel-compatible table or as a Markdown table, from the selection/cell/header menus

> 🎬 *Demo GIF coming soon*

**10 · Row sorting** — column selector popup: one-time sort or live auto-sort with a header indicator

![行排序](docs/demo-10-sort.gif)

**11 · Summary/aggregate rows** — Sum/Average/Min/Max/Count via the Σ icon or column selector popup; per-row remove and reorder

![汇总行](docs/demo-11-aggregate.gif)

**12 · Collapse/expand table** — fold-icon button hides/shows the body while keeping the title and header row visible

![表格折叠/展开](docs/demo-12-collapse.gif)

**13 · Table lock** — 🔒 icon disables all graphical editing for that table

![表格锁定](docs/demo-13-lock.gif)

**14 · Auto-fit all** — ⊞ icon fits every column width and row height to its content in one click

![一键自适应](docs/demo-14-autofit.gif)

**15 · Theme picker** — 🎨 icon switches between built-in themes (`academic`, `grid`, `plain`)

![主题切换](docs/demo-15-theme.gif)

**16 · Split cell** — double-click a plain cell → split into 2 rows/columns; other cells in that row/column keep their current shape

> 🎬 *Demo GIF coming soon*

---

## Keyboard

A cell is in one of three states, and every shortcut below follows from which one you're in.

**Editing** — an editor is open in the cell. This is where a click lands you.

| Key | |
|-----|--|
| `Esc` | Discard the edit, keep the cell **selected** (like Excel — nothing is written) |
| `Enter` | Commit and keep the cell **selected** |
| `Tab` / `Shift`+`Tab` | Commit, then select the next / previous cell |
| `←` `→` | Move the caret. Once it's at the first/last character, commit and select the cell beside it |
| `↑` `↓` | Jump to the start / end of the cell's content. Once there, commit and select the cell above / below |
| `Shift`+`Enter` | Line break inside the cell |

**Selected** — the cell is outlined but no editor is open. Reached with `Esc` or `Enter` above.

| Key | |
|-----|--|
| `←` `→` `↑` `↓` | Move the selection. Left/right wraps to the next row at a row's end; up/down stops at the table's edge |
| `Tab` / `Shift`+`Tab` | Same as `→` / `←` |
| Any character | Start editing, replacing the cell's contents with what you typed |
| `Enter` | Start editing, keeping the contents (fully selected, so one keystroke replaces them) |
| `Backspace` / `Delete` | Clear the cell without opening an editor |

Notes:

- **The header row takes part** — arrow up from the first data row to reach it; typing there renames the column.
- **Merged cells** are entered at their anchor, never at a position they cover; **hidden and filtered-out** rows and columns are skipped.
- **Typed columns** behave per type: a date cell opens the native picker, where the arrow keys step the day/month/year segments instead; a choice cell opens Obsidian's own value menu, which you navigate as any Obsidian menu. `Tab` commits and moves on from either.

---

## Claude Code Skill

A [`SKILL.md`](SKILL.md) is included for use with [Claude Code](https://claude.ai/code). Once installed, Claude agents can create and modify `rich-table` blocks directly in your vault — adding rows, applying styles, defining merges — without you having to remember the syntax.

```bash
cp SKILL.md ~/.claude/skills/rich-table/SKILL.md
```

Then ask Claude: *"Create a project tracker table in my note using rich-table"*.

---

## Settings

Open **Settings → Rich Table** to configure the plugin.

| Setting | Default | Description |
|---------|---------|-------------|
| Allow editing in reading view | Off | When off, all interactive behaviour (hover strips, click-to-edit, panels, dropdowns) is disabled in Obsidian's reading view. Live preview / source mode is always interactive. |
| Single-click to edit | Off | When on, a single click on a cell enters edit mode immediately (no delay), and the style panel opens with Ctrl/Cmd+click instead of double-click. When off (default), single click enters edit after a short delay and double click opens the style panel. |
| Custom types | — | Define custom choice-column types with labels and colors. |

---

## Features & Roadmap

Status: **✅** shipped · **🔜** planned. Priority reflects how well something fits the current design — **P1** fits as it stands · **P2** fits but needs a new piece inside it · **P3** needs architectural change, a heavy dependency, or more thought.

<table>
<thead>
<tr><th align="left">Area</th><th align="left">Capability</th><th align="center">Status</th><th align="center">Priority</th></tr>
</thead>
<tbody>

<tr>
  <td rowspan="6"><b>Editing</b></td>
  <td>Click any cell to edit — full Markdown, with <code>[[</code> triggering Obsidian's own file &amp; heading autocomplete</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Keyboard navigation — arrow keys, Tab, type-to-replace (see <a href="#keyboard">Keyboard</a>)</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Cell, header and selection menus — insert / delete / hide rows &amp; columns, merge, style, column type, alignment</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Excel / Sheets clipboard — paste a range into a cell, copy a selection back out (or as a Markdown table)</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Table title and footer notes — click to edit inline</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Cell comments</td><td align="center">🔜</td><td align="center">P2</td></tr>

<tr>
  <td rowspan="4"><b>Cell content</b></td>
  <td>Full Obsidian Markdown — bold, italic, highlight, <code>[[wikilinks]]</code>, links, lists, multi-line</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Math formulas — inline KaTeX, <code>$E=mc^2$</code></td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Images — <code>![](url)</code> or <code>![[local.png]]</code>, drag an edge to resize</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Another table embedded read-only in a cell</td><td align="center">🔜</td><td align="center">P3</td></tr>

<tr>
  <td rowspan="7"><b>Columns &amp; data</b></td>
  <td>Typed columns — colored pills, click to pick; six built-in types plus your own in Settings</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Filter rows by value — funnel icon on each column header</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Sort rows — one-time, or live with an indicator until cleared</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Summary rows — Sum / Average / Min / Max / Count over the visible rows</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Formulas — Excel-style <code>=SUM(A1:B3)</code>, arithmetic, click/drag to insert a reference</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Progress-bar column type</td><td align="center">🔜</td><td align="center">P1</td></tr>
<tr><td>A chart of the table's own data</td><td align="center">🔜</td><td align="center">P2</td></tr>

<tr>
  <td rowspan="4"><b>Styling</b></td>
  <td>Per-cell background, text color and font size — via panel or YAML</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Row / column selector strips — hover to reveal, style a whole row or column at once</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Themes — <code>academic</code>, <code>grid</code>, <code>plain</code>; plus a few CSS variables for small tweaks (see <a href="#themes">Themes</a>)</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Conditional formatting — styles applied automatically from value rules</td><td align="center">🔜</td><td align="center">P2</td></tr>

<tr>
  <td rowspan="7"><b>Structure</b></td>
  <td>Merge cells, and split a plain cell into two rows or columns</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Drag to reorder rows / columns; drag to resize; double-click or ⊞ to auto-fit</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Insert, hide and delete rows / columns; hover an edge for <b>+</b> strips</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Freeze the header plus the first N rows / columns</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Transposed starting template — row and column headers the same</td><td align="center">🔜</td><td align="center">P1</td></tr>
<tr><td>Transpose in place — swap rows and columns</td><td align="center">🔜</td><td align="center">P2</td></tr>
<tr><td>Row grouping — collapsible groups</td><td align="center">🔜</td><td align="center">P3</td></tr>

<tr>
  <td rowspan="2"><b>Views</b></td>
  <td>Kanban — lanes from any choice column; drag a card to change its value</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Calendar — a month grid from any date column; drag an event to reschedule</td><td align="center">✅</td><td align="center">—</td></tr>

<tr>
  <td rowspan="2"><b>Multi-sheet</b></td>
  <td>Workbooks — an Excel-style tab bar once a table has two or more sheets, each with its own columns, rows, styles and views</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Tabs — click to switch, double-click to rename, drag to reorder, right-click for color / delete</td><td align="center">✅</td><td align="center">—</td></tr>

<tr>
  <td rowspan="3"><b>Whole table</b></td>
  <td>Lock — 🔒 disables every graphical edit for that table</td>
  <td align="center">✅</td><td align="center">—</td>
</tr>
<tr><td>Collapse — hide the body, keeping the title and header row</td><td align="center">✅</td><td align="center">—</td></tr>
<tr><td>Back a table with an external <code>.xlsx</code> file and edit it from Obsidian</td><td align="center">🔜</td><td align="center">P3</td></tr>

</tbody>
</table>

---

## Format

````markdown
```rich-table
---
version: 2
title: Project tracker
columns:
  - id: c_000000
    name: Task
    width: 200
  - id: c_000001
    name: Status
    type: task-status
    width: 110
rows:
  - id: r_000000
    cells:
      c_000000: "**Design** — architecture review"
      c_000001: done
  - id: r_000001
    cells:
      c_000000: Build
      c_000001: pending
  - id: r_000002
    cells:
      c_000000: |-
        - Write tests
        - Fix edge cases
      c_000001: todo
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
<!-- Generated by Rich Table. Do not edit below — data source is the YAML front-matter above. -->
| Task                          | Status  |
| ----------------------------- | ------- |
| **Design** — architecture ... | done    |
| Build                         | pending |
| - Write tests<br>- Fix edge.. | todo    |
```
````

The YAML front-matter is the **only data source**. The pipe table below the `<!-- Generated … -->` comment is a read-only mirror regenerated on every write-back and can be safely ignored.

**Cell content** supports full Obsidian Markdown: `**bold**`, `*italic*`, `[[wikilinks]]`, `[links](url)`, `![images](url)`, `- lists`, `$math$`, `<br>` for line breaks.

**Style targets** (v2 ID-based):

| Target | Meaning |
|--------|---------|
| `header` | Entire header row |
| `header.c_xxx` | Single header cell |
| `r_xxx` | Entire data row |
| `c_xxx` | Entire column (including header) |
| `r_aaa:r_bbb` | Row range |
| `c_aaa:c_bbb` | Column range |
| `r_aaa.c_aaa:r_bbb.c_bbb` | Rectangle range |
| `r_xxx.c_yyy` | Single data cell |

> **Upgrading from v0.x?** Tables written in the old format automatically show an upgrade banner. Click **Convert to new format** for one-click migration, or **Keep old format** to continue reading without converting.

---

## Formulas

Type `=` into a plain cell to start a formula — same trigger as Excel/Sheets. Supports arithmetic (`+ - * /`, parentheses) and `SUM` / `AVG` / `MIN` / `MAX` / `COUNT` over a range. While typing, click another cell to insert a reference, or drag to insert a range — no need to type a cell address by hand.

A formula follows the row/column it references, not its position, so inserting or reordering rows/columns never breaks it. A deleted reference shows `#REF!`; other results are `#CIRCULAR!` (self-reference), `#DIV/0!`, and `#VALUE!`.

---

## Themes

Add `theme:` to the YAML front-matter to apply a built-in visual theme:

```yaml
theme: academic   # LaTeX booktabs style — three horizontal rules, no grid lines
theme: grid       # Excel "All Borders" style — full grid, bold outer frame + header rule
theme: plain      # Colorful gradient header + animated border
```

| Theme | Description |
|-------|-------------|
| *(none)* | Default — no special styling |
| `academic 📐` | Inspired by LaTeX's booktabs package: toprule / midrule / bottomrule, no vertical lines, no cell backgrounds |
| `grid 🔲` | Full grid on every cell, a bolder outer frame, and a bolder rule separating the header from the data |
| `plain 🙂` | Animated rainbow border, gradient header with breathing effect, cursor-reactive row glow |

Themes are purely visual — they never affect data or layout.

**Quick customization without a theme:** for a small tweak (not a full theme), set one of these CSS variables on `.bt-render-root` in an Obsidian CSS snippet — no selectors needed:

| Variable | Controls | Default |
|----------|----------|---------|
| `--bt-border-outer` | Table's outer edge | `none` |
| `--bt-cell-border` (+ `-right`/`-bottom`) | Gridlines between cells | `none` |
| `--bt-cell-bg` | Data cell background | `transparent` |
| `--bt-header-bg` | Header cell background | theme default |
> A cell draws only its **right** and **bottom** edge; the table's own `--bt-border-outer` supplies the grid's top and left edge. `--bt-cell-border-top`/`-left` are still accepted but no longer contribute to gridlines — with one border per edge, drawing all four would render every internal line at double thickness. This is what lets frozen rows/columns keep their gridlines while scrolling.

```css
.bt-render-root {
  --bt-header-bg: #223;
  --bt-cell-bg: #fafafa;
  --bt-border-outer: 2px solid #888;
}
```

A manually-set per-cell style (via the style panel) always wins over both themes and these variables.

---

## Known Issues

| Issue | Workaround |
|-------|-----------|
| **Reading mode: v2 tables remain interactive** — In Obsidian reading view, v2-format tables still show hover strips and allow editing. The `allowReadingViewEdit` setting has no effect on v2 tables. v1 tables (awaiting upgrade) are correctly read-only. | Use the 🔒 lock button to prevent accidental edits in reading mode. |

---

## License

[AGPL-3.0](LICENSE) — derivatives must be open-sourced under the same license.

For **commercial licensing**: sdkxyx@gmail.com

---

## Support the Project
Rich Table is free and open-source under the AGPL-3.0 license. If this plugin has improved your workflow, you can support its ongoing development with a voluntary donation. Every contribution helps fix bugs, add new features, and maintain compatibility with future Obsidian updates.

### 💳 PayPal
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-003087?style=flat-square&logo=paypal&logoColor=white)](https://paypal.me/ssdking)

### 🧧 WeChat Pay / Alipay

| WeChat Pay | Alipay |
|:---:|:---:|
| <img src="docs/wechat-donate.jpg" width="120" alt="WeChat Pay donation QR code" /> | <img src="docs/alipay-donate.jpg" width="120" alt="Alipay donation QR code" /> |

Thank you for your support! 🙏

---

## Feedback

Issues and feature requests: [GitHub Issues](https://github.com/SdKay/obsidian-rich-table/issues)

---

[![Star History Chart](https://api.star-history.com/svg?repos=SdKay/obsidian-rich-table&type=Date)](https://star-history.com/#SdKay/obsidian-rich-table&Date)

