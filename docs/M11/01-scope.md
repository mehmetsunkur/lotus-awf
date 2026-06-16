# 01 — Scope

## M11 objective

Turn the form studio into a visual layout editor: a citizen arranges a form's fields into sections —
reordering and re-grouping with accessible controls and drag-and-drop — and sees a live preview, all
producing valid, back-compatible definitions saved local-first.

## The layout model (key decision)

Reordering is driven by **accessible move-up/down buttons and a move-to-section control** (the
"schema-driven" reorder, and the deterministic e2e contract), with **native HTML5 drag-and-drop** as a
progressive enhancement over the same operations — **no DnD library is added** (the stack stays
dependency-light). Every layout mutation routes through a pure `src/shared/form-layout.ts` engine so
the rules are deterministic and unit-tested. The studio previews with the runtime `DocumentForm` in a
read-only `preview` mode (true WYSIWYG). See `docs/decisions/0006-citizen-layout-dnd.md`.

## In scope

- A pure engine `src/shared/form-layout.ts`: `ensureSections`, `moveFieldWithinSection`,
  `moveFieldToSection`, `addSection`, `renameSection`, `moveSection`, `removeSection`,
  `addFieldToSection`, `removeField`, `renameField`, `isLayoutNormalized`.
- A section-grouped `FormStudio`: section add/rename/reorder/remove; field reorder within/between
  sections via buttons and native drag.
- A live preview reusing `DocumentForm` (`preview` mode; `FieldEditor` gains a `testIdPrefix` so preview
  fields do not collide with the live form).
- Local-first saves through the existing shared-validation `PUT /api/definitions` path.

## Out of scope

- Creating brand-new definitions from scratch (needs a server upsert path) — a candidate M12.
- A drag-and-drop library (dnd-kit / react-dnd).
- Visual workflow-graph editing; view-column drag reordering.
- Splitting the studio out of `main.tsx` (kept single-file per the client convention).
- Any server / replication / ACL / contract change.

## The normalized-form invariant

The runtime renders fields **by section**, so a field outside every section would be invisible. Every
layout operation therefore preserves: `sections` is non-empty and **every field appears in exactly one
section**. Removing a section reassigns its fields to the first remaining one; the last section cannot
be removed. `isLayoutNormalized` is the studio's safety net and the unit tests' assertion.

## Product framing

M11 is the Notes form-designer re-centered on metadata-as-data: the citizen shapes layout visually,
the developer's definitions-as-code still round-trips the same `FormSection` shape, and the preview is
the runtime — no separate design surface to drift.
