# Themes

The built-in visual themes selected with the `theme` field.

## Themes

Set the `theme` field in the YAML front-matter to apply a built-in visual theme.

### Available themes

**`academic`** — LaTeX booktabs style
- Only three horizontal rules: thick line above header, medium line below header, thick line after last row
- No vertical lines, no cell backgrounds, minimal distraction

```yaml
theme: academic
```

**`grid`** — Excel "All Borders" style
- Every cell boundary visible, a bolder outer frame, and a bolder rule between the header and the data

```yaml
theme: grid
```

Only `academic` and `grid` exist. Leave the field out for the default look. A value that is not one of
these (for example `plain`, which was removed) is drawn with the theme the user set for new tables, so do
not write it.

### Applying a theme

Add `theme:` to the YAML front-matter alongside other fields:

````markdown
```rich-table
---
version: 2
theme: academic
columns:
  - id: c_000000
    name: Method
    width: 160
  - id: c_000001
    name: Result
    width: 120
rows:
  - id: r_000000
    cells:
      c_000000: Control
      c_000001: 0.42 ± 0.03
  - id: r_000001
    cells:
      c_000000: Treatment A
      c_000001: 0.67 ± 0.04
---
```
````

### Switching themes

Change the `theme:` value (or remove it). The visual appearance updates immediately when the plugin re-renders the block.
