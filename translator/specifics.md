# Translator Specifics

This folder is the handoff harness for incrementally replacing hand-written TS
ports with direct translations from the Python source tree.

## Command

Run:

```sh
pnpm run translate
```

The package script compiles `translator/translate.ts` with
`translator/tsconfig.json`, emits JS into `.tmp/translator`, then runs the
compiled script with Node.

## Inputs

- `translator/files.txt` is the ordered translation queue.
- `translator/progress.txt` contains one non-negative integer `N`.
- The translator reads the first `N` entries from `files.txt`.
- The Python source root defaults to `../crimson/src`.
- The TS output root defaults to `src`.
- `PY_SOURCE_ROOT` and `TS_TARGET_ROOT` can override those roots.

## Progress Loop

1. Increment `translator/progress.txt` by one.
2. Run `pnpm run translate`.
3. Inspect the generated git diff.
4. If the TS source diff is formatting-only or otherwise a correct direct
   translation, keep it.
5. If the diff changes behavior or the translator fails, fix
   `translator/translate.ts` and rerun until the selected prefix translates
   correctly.
6. Run validation, then commit the translator changes, `progress.txt`, and the
   generated TS change together.
7. Repeat until `progress.txt` equals the line count of `translator/files.txt`.

## File Ordering

`translator/files.txt` was generated from all `*.py` files under
`../crimson/src`, ordered by an AST-based complexity score. Node count and
control-flow constructs dominate the score. Import count is only a weak
tie-breaker because translation is per-file and dependency fan-out should not
push otherwise simple files late in the queue.

## Path Mapping

Python relative paths are mapped into TS paths as follows:

- Path components convert underscores to hyphens.
- `__init__.py` maps to `index.ts`.
- Other `.py` files map to `.ts`, also converting underscores to hyphens in the
  filename.

Examples:

- `crimson/modes/__init__.py` -> `src/crimson/modes/index.ts`
- `crimson/game/loop_view.py` -> `src/crimson/game/loop-view.ts`
- `grim/sfx_map.py` -> `src/grim/sfx-map.ts`

## Current Translator Rules

The translator currently handles only the first simple package modules:

- Removes `from __future__ import annotations`.
- If nothing remains, emits only `// Port of <python path>`.
- If only a module docstring remains, emits the port marker plus the docstring
  as TS comments.

Unsupported files intentionally fail with:

```text
translator not implemented for <py> -> <ts>
```

That failure is the expected signal to implement the next translation rule.

## Current Progress

At the time this document was added, `translator/progress.txt` is `2`, covering:

- `crimson/modes/components/__init__.py`
- `crimson/modes/__init__.py`
