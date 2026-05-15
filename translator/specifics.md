# Translator Specifics

This translator is intentionally per-file: a simple file should translate early
even if it imports many modules. Dependency fan-out is not a strong complexity
signal for this workflow.

## Inputs And Roots

- `translator/files.txt` is the ordered queue of Python source files.
- `translator/progress.txt` contains the selected prefix length.
- Python sources default to `../crimson/src`.
- TS outputs default to `src`.
- `PY_SOURCE_ROOT` and `TS_TARGET_ROOT` override those roots.

## File Ordering

`translator/files.txt` was generated from all `*.py` files under
`../crimson/src`, ordered by an AST-based complexity score. Node count and
control-flow constructs dominate the score. Import count is only a weak
tie-breaker.

## Path Mapping

Python relative paths map into TS paths as follows:

- Path components convert underscores to hyphens.
- `__init__.py` maps to `index.ts`.
- Other `.py` files map to `.ts`, also converting underscores to hyphens in the
  filename.

Examples:

- `crimson/modes/__init__.py` -> `src/crimson/modes/index.ts`
- `crimson/game/loop_view.py` -> `src/crimson/game/loop-view.ts`
- `grim/sfx_map.py` -> `src/grim/sfx-map.ts`

## Current Translation Rules

- Removes `from __future__ import annotations`.
- If nothing remains, emits only `// Port of <python path>`.
- If only a module docstring remains, emits the port marker plus the docstring
  as TS comments.

## Quirks

- Unsupported files intentionally fail with
  `translator not implemented for <py> -> <ts>`.
- The generated diff is the quality check: formatting-only TS diffs are
  acceptable; behavioral or structural mismatches mean the translator needs a
  rule fix before progress advances further.
