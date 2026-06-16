# 03 — Studio Runtime

## The studio UI (`FormStudio`)

The form studio renders fields **grouped by section**. Each section is a `<fieldset>` with:

- a title input (`renameSection`), move-up/down buttons (`moveSection`), and a remove button
  (`removeSection`, disabled when only one section remains);
- its field rows, each with the existing name/label/type/required controls plus **move-up/down**
  (`moveFieldWithinSection`), a **move-to-section** select (`moveFieldToSection`), a remove button,
  and a drag handle;
- an "Add Field" button that places a new field in that section.

Below the sections: a top-level "Add Field" (appends to the last section) and "Add Section". Every
control calls a pure `src/shared/form-layout.ts` operation and feeds the result back through the
studio's `onChange` (which updates the in-memory definition / JSON), so the rules are never duplicated
in the component.

## Reordering: buttons first, drag as enhancement

Move-up/down buttons and the move-to-section select are the **primary, accessible, keyboard-operable**
reorder mechanism and the deterministic e2e contract. Field rows are also `draggable`: `onDragStart`
records the dragged field, a section's `onDragOver`/`onDrop` calls `moveFieldToSection`. Native HTML5
drag is a **progressive enhancement over the same operations** — no library, and it is only smoke-tested
because HTML5 DnD under Playwright is environment-sensitive.

## Live preview (WYSIWYG)

Beside the studio, a read-only preview renders the in-progress form with the **runtime `DocumentForm`**
in `preview` mode — the same renderer the runtime uses, so layout changes appear exactly as they will at
runtime. Preview mode hides save/delete/new, the workflow bar, the audit trail, and the validation-error
box, and namespaces its field testids (`preview-field-*`) so they never collide with the live form.
`validatePayload` still runs (parity preserved); only its UI is suppressed.

## Save flow

Saving runs shared `validateDesignDefinition` then `PUT /api/definitions/:id` — the unchanged M4
local-first path. Layout edits are ordinary definition writes; they replicate like any other
definition.

## Limits

- Native drag-and-drop is smoke-tested, not a hard e2e gate (the accessible controls are).
- Creating a brand-new form/view/workflow from scratch is deferred (needs a server upsert path).
- The studio remains in `main.tsx` (the documented single-file shell).
