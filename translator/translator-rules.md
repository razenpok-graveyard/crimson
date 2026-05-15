1. FUNCTION COMPLETENESS — every function/class/method in Python exists in TS
2. LOGIC FIDELITY — compare logic line-by-line, flag behavioral differences
3. CONSTANTS — every numeric/string literal matches exactly
4. f32() WRAPPING — every f32() in Python has a corresponding f32() in TS
5. ENUM VALUES — all members match in name and numeric value
6. DATA TABLES — every row/field in weapon/creature/quest/perk tables matches
7. WIP SCAFFOLDING & STUBS — flag any TS function that's empty/dummy where Python has real logic, and any of these work-in-progress patterns that should have been replaced with real implementations:
   - Structural type stubs standing in for real classes (e.g. `interface WorldRuntime { ... }` declared locally instead of importing the actual class)
   - Forward-declared interfaces with comments like "not yet ported", "will be replaced", "stub type"
   - Minimal/partial interfaces that admit they're incomplete (e.g. "minimal interface needed by X", "full class will be ported in Phase N")
   - `as any` casts that paper over missing type imports or incomplete interfaces
   - Comments containing "TODO", "FIXME", "HACK", "TEMP", "Phase N", "not yet ported", "stub", "forward-reference", "forward-declared"
   - Type aliases to `unknown` where a concrete type should exist (e.g. `effects: unknown`)
   - Placeholder no-op methods with comments explaining the real logic isn't ported yet
8. GL STATE RESTORATION — any function that changes GL state (blend mode, color mask, alpha test) must restore it before returning. Compare with Python's `rl.begin_blend_mode()` / `rl.end_blend_mode()` pairs.
9. DETACHED METHOD REFERENCES — any place a class method is passed as a callback (e.g. `playSfx: this.router.playSfx`) loses `this` binding in JS/TS. Python binds methods automatically. Must use arrow wrapper: `(id) => this.router.playSfx(id)`.
10. HANDLER/CALLBACK REGISTRATION — check that all handlers Python registers in a dict/map are also registered in TS. Look for empty `Map()` declarations with comments like "will be registered later" where Python populates them inline. Also check that side-effect imports (files that register on import) are imported from the barrel `index.ts`, not directly from the registry module.
11. BASE CLASS STUB OVERRIDES — when a base class declares a no-op `protected` method, verify that every subclass that needs the behavior overrides it. In Python the subclass often calls the component directly; the TS port may have introduced an indirection layer of empty base methods that were never wired up.
12. FUNCTION SIGNATURE & ARGUMENTS PARITY — check that TS function signatures match their call sites, the `WorldDtStep`/`PlayerDeathHook`/`PerkApplyHandler` type definitions, and the Python equivalents. Common issues: positional args vs object args, extra function parameters that Python imports at module level but TS passes as arguments, local context interfaces that duplicate free functions as methods. For named Python arguments (`*`), use the `opts` parameter in TS.
13. NAMING CONVENTION VIOLATIONS — check that TS functions, classes, and variables are named according to TS conventions (e.g. `rewardValue` instead of `reward_value`)
14. RE-EXPORTS — the previous audit passes might have replaced structural type stubs with real classes, but they kept the original exports and just re-export the original one. They original classes should be imported from the original location.
15. UNNECESSARY TYPE ASSERTIONS — flag `as Type` casts that are redundant because the expression already has the correct type. Common pattern: `(this.state.bonusHud as BonusHudState)` when `this.state.bonusHud` is already typed as `BonusHudState`. These casts add noise and can mask type errors if the underlying type changes.
16. RAYLIB CALL PARITY - all `rl.*` calls should be replaced with equivalent TS `wgl.*` calls.
17. COMMENTS PARITY - if there is a Python comment explaining some logic or porting specifics, a matching TS comment should be present. The TS code should not contain any structural comments not present in the Python code.
18. PROPER FUNCTION/TYPE SOURCES - the TS files should not declare local function/types that Python imports from elsewhere.
19. `int()` WRAPPING - TS code must use the globally-provided `int()` function instead of `Math.round()` or `| 0` conversions. No import statement for `int` function is needed, as it is provided by the `unimport` plugin. Python's `//` (floor division) must be translated as `Math.floor()`.
20. `float()`, `str()`, `bool()` WRAPPING - TS code must ignore the Python `float()`, `str()`, and `bool()` calls when applied to variables that are known to have the correct type.
21. PORT COMMENT - each file must start with a "// Port of path/to/original/file.py\n\n" comment, for example "// Port of crimson/game/loop_view.py\n\n"
22. DO NOT PORT USELESS THINGS - for example, from `__init__.py` files, do not port the `__all__` variable, as TS doesn't use it. You can port the `__init__.py` parts that re-export types, as it serves the same purpose as barrel files in TS. Do not port files that would be empty, for example, if `__init__.py` would become empty if we omit `__all__` from it.
23. PORTING `msgspec.Struct` - port it as a class, and the class is constructed from the opts object, to preserve the named arguments at the constructor call site. Do not use `Object.freeze` for `frozen=True` structs, but mark each field as readonly.

**Acceptable differences (don't flag):**
- Import style, type annotation syntax, self→this
- None→null/undefined
- Networking/replay/debug code intentionally excluded
- Dropping enum casts on numbers (e.g. Python `WeaponId(ctx.amount)` → TS `ctx.amount`) — TS enums provide no runtime validation, so raw numbers are preferred
