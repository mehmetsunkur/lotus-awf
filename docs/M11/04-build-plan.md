# 04 — Build Plan

## Step 1 — Pure layout engine

Add `src/shared/form-layout.ts` (`ensureSections`, `moveFieldWithinSection`, `moveFieldToSection`,
`add/rename/move/removeSection`, `addFieldToSection`, `removeField`, `renameField`,
`isLayoutNormalized`). Unit-test that the normalized-form invariant holds after every operation.

## Step 2 — Studio rework + preview

Rework `FormStudio` into a section-grouped editor: section add/rename/reorder/remove; field reorder
within/between sections via move buttons, a move-to-section select, and native HTML5 drag — all routed
through the layout engine. Add a read-only `preview` mode to `DocumentForm` and a `testIdPrefix` to
`FieldEditor`; render a live preview in `DefinitionEditor`. Preserve the M4 studio testids. Add CSS.

## Step 3 — e2e

Add `tests/e2e/layout-studio.spec.ts`: reorder within a section (preview reflects it), add a section +
move a field in + runtime renders the group, remove a section reassigns fields, and a non-blocking
native-drag smoke. Keep `tests/e2e/authoring-studio.spec.ts` green.

## Step 4 — Docs

Add these M11 docs and `docs/decisions/0006-citizen-layout-dnd.md`; add the Form-layout authoring
invariant (with `Paths:`); reconcile the `docs/context/*` cards and bump baselines.

## Step 5 — Verify

`npm run build`, `npm run test:unit`, `npm run test:e2e`. (No Tier-3 review — no substrate change.)
