# Common patterns

Complete example blocks to adapt.

## Common patterns

### Minimal table (no YAML needed)
For very simple tables, omit the YAML and use the legacy v1 format — the plugin will show an upgrade banner but still render the table:

````markdown
```rich-table
| Name   | Role      | Team  |
| ------ | --------- | ----- |
| Alice  | Engineer  | Core  |
| Bob    | Designer  | UX    |
```
````

For new tables, always prefer v2 format with explicit IDs.

### Task board (v2)
````markdown
```rich-table
---
version: 2
title: Sprint 12
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
  - id: c_000003
    name: Due
    type: date
    width: 110
rows:
  - id: r_000000
    cells:
      c_000000: Design mockups
      c_000001: done
      c_000002: "[[Alice]]"
      c_000003: 2025-01-10
  - id: r_000001
    cells:
      c_000000: Backend API
      c_000001: in-progress
      c_000002: "[[Bob]]"
      c_000003: 2025-01-20
  - id: r_000002
    cells:
      c_000000: Integration tests
      c_000001: todo
      c_000003: 2025-01-28
styles:
  - target: header
    bold: true
    bg: "#f0f4ff"
footer: "Sprint ends 2025-02-14"
---
```
````

### Rich cell content (math, lists, images)
````markdown
```rich-table
---
version: 2
columns:
  - id: c_000000
    name: Feature
    width: 130
  - id: c_000001
    name: Example
    width: 300
rows:
  - id: r_000000
    cells:
      c_000000: Math
      c_000001: '$E=mc^2$ · $\sqrt{2} \approx 1.414$'
  - id: r_000001
    cells:
      c_000000: List
      c_000001: |-
        - First item
        - Second item
  - id: r_000002
    cells:
      c_000000: Multiline
      c_000001: "Line 1<br>Line 2<br>Line 3"
  - id: r_000003
    cells:
      c_000000: Image
      c_000001: "![](https://example.com/img.png)"
styles:
  - target: header
    bold: true
    bg: "#e8f0fe"
---
```
````

### Dashboard with merged header group
````markdown
```rich-table
---
version: 2
columns:
  - id: c_000000
    name: Project
    width: 180
  - id: c_000001
    name: Q1
    align: center
    width: 80
  - id: c_000002
    name: Q2
    align: center
    width: 80
  - id: c_000003
    name: Q3
    align: center
    width: 80
rows:
  - id: r_000000
    cells:
      c_000000: Product A
      c_000001: $120k
      c_000002: $140k
      c_000003: $160k
  - id: r_000001
    cells:
      c_000000: Product B
      c_000001: $80k
      c_000002: $95k
      c_000003: $110k
merges:
  - anchor: header.c_000001
    end:    header.c_000003
styles:
  - target: header
    bold: true
    bg: "#fff3cd"
---
```
````
