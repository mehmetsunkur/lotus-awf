# M20 - Generic NSF Runtime Shell

M20 makes the Notes-style two-pane shell the default UI contract for `.nsf` routes. `expense.nsf`,
`setup.nsf`, and `catalog.nsf` all open as database applications instead of mixing one metadata
runtime with separate one-off pages.

The milestone is a shell/runtime unification step. It does not require every system action to be pure
metadata yet; setup and catalog can still call privileged platform APIs from panels inside the common
workspace.

## Documents

- `01-scope.md`
- `02-route-contract.md`
- `03-runtime-flow.md`
- `04-build-plan.md`
- `05-acceptance.md`
- `06-implementation-notes.md`
