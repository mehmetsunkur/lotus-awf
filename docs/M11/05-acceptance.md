# 05 — Acceptance

## Demo scenario

1. Open the studio and select `form:expense`; fields are grouped into their sections (Spend,
   Accounting) with a live preview beside them.
2. Move a field up/down within a section; the preview reorders to match.
3. Add a section, rename it, and move a field into it via the move-to-section control; the preview
   shows the new grouping.
4. Save; open the runtime and confirm the form renders the new section grouping (a `<legend>` for the
   new section).
5. Remove a section; its fields are reassigned to a remaining section (none disappear), and the last
   section cannot be removed.
6. Drag a field row onto another section; it moves (best-effort enhancement over the same operation the
   buttons use).

## Exit criteria

M11 is complete when the project can prove:

- a citizen can reorder fields within a section and move them between sections, visually, with no JSON;
- sections can be created, renamed, reordered, and removed, with removal reassigning fields so none is
  orphaned and the last section protected;
- every layout operation keeps the form normalized (every field in exactly one section) — unit-verified
  via `isLayoutNormalized` after each op;
- the live preview renders with the runtime renderer, so what the citizen arranges is what the runtime
  shows;
- edits save local-first through the existing shared-validation path, producing back-compatible
  definitions, with no server change;
- the M4 authoring flow still passes (no studio regression).
