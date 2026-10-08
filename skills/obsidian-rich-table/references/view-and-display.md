# Table-level display fields

Optional top-level fields that change how a table looks or behaves: `theme`, `locked`, `collapsed`, `sort`, `aggregate`, `freezeRows`/`freezeCols`, `viewWidth`/`viewHeight`, `zoom`, `statusBarMode`, `statusBarScrollWidth`, `views`/`activeViewId`. The theme choices themselves are listed in [themes.md](themes.md).

### `theme` (string, optional)
Built-in visual theme applied to the table. Themes control appearance only
(colors, borders, fonts) and never affect data.

| Value | Appearance |
|-------|-----------|
| *(omit)* | Default — no special styling |
| `academic` | Booktabs style: three horizontal rules only (toprule / midrule / bottomrule), no vertical lines, no backgrounds |
| `plain` | Purple/blue gradient header, rounded corners with outline border, row hover highlight, centered |

```yaml
theme: academic
```

### `locked` (boolean, optional)
When `true`, all graphical editing is disabled for this table.

### `collapsed` (boolean, optional)
When `true`, only the title (if any) and header row render — the table body
and footer are hidden. Toggle via the fold-icon button in the top-left corner.

### `sort` (object, optional)
Live/persistent row sort — the popup menu opened by selecting a single column
in the column selector strip has two sort modes:
- **"Sort ascending" / "Sort descending"** — one-time: reorders `rows[]` in the
  YAML immediately, then forgets about it. No `sort` field is written; manual
  drag-reorder keeps working normally afterward.
- **"Keep sorted ascending" / "Keep sorted descending" / "Clear live sort"** —
  live: writes this `sort` field instead of touching `rows[]`. Re-applied on
  every render (so newly-inserted rows also land in the right place), and
  disables the row drag-grip while active since the display order is derived,
  not stored. A live sort in effect also shows a small always-visible
  indicator directly in that column's header cell (same corner as the filter
  button, stacked above it if both are active on that column), independent of
  the popup menu, specifically so it's never silently forgotten — click it to
  clear.

Both modes are omitted/disabled while any `merges` entry spans more than one
row (filter stays on its own funnel icon in the header — unaffected by any of
this).

```yaml
sort:
  colId: c_000001
  dir: desc  # or asc
```

### `aggregate` (array of `sum`|`avg`|`min`|`max`|`count`, optional)
Active summary/statistic rows — **table-wide, not per-column**: turning on
`sum` shows one summary row computing a sum for every column where that's
meaningful (numeric cells), leaving columns with no numeric data blank in that
row. Array order is render order (top to bottom).

Toggle via the Σ icon in the left control column (next to lock/auto-fit/theme),
or via the "Sum"/"Average"/"More" group in the column selector's popup menu
(same table-wide toggle, just reachable from a column-selection context too —
it does **not** scope the statistic to that column). Each rendered summary row
also gets its own row-selector cell — click it for a "Remove this summary row"
menu, or drag its grip to reorder that row among the other summary rows.

```yaml
aggregate:
  - sum
  - avg
```

### `freezeRows` / `freezeCols` (non-negative integer, optional)
Keeps the header row plus the first `freezeRows` data rows (`freezeRows: 0` = header only), and/or the first `freezeCols` columns, visible while the table scrolls. A position, not a set of IDs: reordering rows changes which rows are in the frozen region. Omit the field for no freeze. A count that would cut a merged cell in half is invalid; the plugin shrinks it to the largest count that does not, so do not write one.

```yaml
freezeRows: 1
freezeCols: 1
```

### `viewWidth` / `viewHeight` (number in px, optional)
Fixed size of the table's viewport, set by dragging the view's edges. Omit for automatic size: width hugs the table (capped at the page, wider tables scroll horizontally) and height grows with the content up to about the screen height, then scrolls inside the view. Only write these when the user asked for a fixed size.

```yaml
viewWidth: 640
viewHeight: 360
```

### `zoom` (number, optional)
Display scale in percent, 25 to 400; omit for 100. Out-of-range values are clamped. It scales the table only, not the status bar.

```yaml
zoom: 125
```

### `statusBarMode` (`pinned` | `hover`, optional)
Whether the bottom status bar (selection stats, zoom, horizontal scrollbar) is shown. Omit or `pinned` = shown. `hover` is the stored value for **hidden**; the name is historical and kept so existing notes keep working. A workbook with two or more sheets always shows the bar, because the sheet tabs live in it.

### `statusBarScrollWidth` (number in px, optional)
Width of the status bar's right-hand section (stats and scrollbar), set by dragging the divider. Omit for the default width.

### `views` and `activeViewId` (optional)
Extra ways to display the same rows besides the default table. Omit both for just the table.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `id` | string | Stable view ID |
| `type` | `table` \| `kanban` \| `calendar` | View kind |
| `name` | string | Optional. Omitted: derived from the grouping column, and follows its renames |
| `kanban.groupByColId` | string | Required for `kanban`: a column with a choice type; its options become lanes |
| `calendar.dateColId` | string | Required for `calendar`: a `type: date` column; rows with an empty or invalid date go to an "Unscheduled" tray |

`activeViewId` selects which entry is shown; absent or unmatched means the default table. Deleting or retyping the column a view depends on removes that view.

```yaml
views:
  - id: v_000000
    type: kanban
    kanban:
      groupByColId: c_000001
activeViewId: v_000000
```
