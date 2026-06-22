# 01 - Scope

## Objective

Make the standard two-pane NSF workspace the baseline UI for all first-party `.nsf` routes:
`setup.nsf`, `catalog.nsf`, and `expense.nsf`.

## In Scope

- Parse `.nsf` routes generically by app slug instead of hardcoding only `expense.nsf`.
- Reuse the standard left-navigation/right-content workspace for system and business apps.
- Keep `expense.nsf` behavior stable while moving it behind generic route helpers.
- Render `setup.nsf` in the standard shell with People, Groups, and Installed Apps sections.
- Render `catalog.nsf` in the standard shell with System Apps, Installed Apps, and Sample Templates
  sections.
- Keep existing setup/catalog privileged actions backed by their current APIs.
- Keep `/login.nsf` as the special authentication entry outside the standard shell.
- Add regression coverage proving all three `.nsf` routes use the standard shell.

## Out Of Scope

- Converting setup/catalog actions into generic metadata actions.
- Replacing manager-only directory APIs with form saves.
- Full app ACL editor.
- Arbitrary user-installed multi-app routing beyond the currently advertised system apps and
  installed business apps.
- Offline login.
