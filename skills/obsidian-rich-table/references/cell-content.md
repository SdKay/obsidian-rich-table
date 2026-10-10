# Cell content and column types

What a cell value may contain, and the built-in choice column types.

## Cell content

Cell values are plain strings rendered by Obsidian's `MarkdownRenderer`. Supported content:

| Content | Example |
|---------|---------|
| Plain text | `Hello world` |
| Bold / italic | `**bold** · *italic* · ***both***` |
| Highlight | `==highlight==` · colored: `==🔴red==` (🔴 🟠 🟡 🟢 🔵 🟣 right after the opening `==`) |
| Wikilink | `[[Note title]]` |
| External link | `[label](https://example.com)` |
| Image | `![](https://example.com/img.png)` |
| Local image | `![[image.png]]` |
| Inline math (KaTeX) | `$E=mc^2$` |
| Line break | `Line 1<br>Line 2` |
| List items | Use YAML block scalar `\|-` with `- ` prefix lines |
| Nested rich-table | A whole ` ```rich-table ` fenced block, itself in v2 format, inside the cell's own block scalar — see below |

**List example** (the `- ` prefix lines render as a compact bulleted list):
```yaml
c_000000: |-
  - First item
  - Second item
  - Third item
```

**Nested table example** — a cell's own value can be a complete, independent `rich-table` block (own `columns`/`rows`/`merges`/`styles`, sequential IDs starting at `c_000000`/`r_000000` again — nested IDs don't need to avoid colliding with the outer table's, they're two separate documents):
````yaml
c_000001: |-
  ```rich-table
  ---
  version: 2
  columns:
    - id: c_000000
      name: Subtask
    - id: c_000001
      name: Status
      type: task-status
  rows:
    - id: r_000000
      cells:
        c_000000: Write tests
        c_000001: done
  ---
  ```
````
It renders and behaves as a fully independent, interactive table in place — editing, sorting, styling it never touches the outer table. There is no limit on nesting depth, but keep it to one or two levels for readability.

**Math example** (backslash is literal in YAML):
```yaml
c_000000: '$\sqrt{2} \approx 1.414$'
```

---

## Built-in column types

| Type ID       | Values (use the value string in cells) |
| ------------- | -------------------------------------- |
| `task-status` | `todo` · `pending` · `in-progress` · `done` · `cancel` |
| `priority`    | `high` · `medium` · `low` |
| `boolean`     | `yes` · `no` |
| `rating`      | `1` ★ · `2` ★★ · `3` ★★★ · `4` ★★★★ · `5` ★★★★★ |
| `effort`      | `xs` · `s` · `m` · `l` · `xl` |
| `approval`    | `approved` · `pending` · `rejected` |
| `date`        | ISO date string `YYYY-MM-DD` |
