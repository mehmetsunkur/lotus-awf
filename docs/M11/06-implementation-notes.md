# 06 — Implementation Notes

## Implemented behavior

M11 turns the form studio into a visual layout editor:

- a pure engine (`src/shared/form-layout.ts`) — section/field operations that preserve the normalized
  form (sections non-empty; every field in exactly one section);
- a section-grouped `FormStudio` — section add/rename/reorder/remove and field reorder within/between
  sections via accessible move buttons, a move-to-section select, and native HTML5 drag, all routed
  through the engine;
- a live preview reusing the runtime `DocumentForm` in a read-only `preview` mode (WYSIWYG);
- local-first saves through the unchanged shared-validation `PUT /api/definitions` path — no server
  change.

## Architecture

Layout decisions are pure and portable (`src/shared/form-layout.ts`), unit-tested, exactly like the
search/audit/agent engines; the studio component is a thin view over them. The preview reuses the
runtime renderer, so the design surface cannot drift from the runtime. `FieldEditor` gained a
`testIdPrefix` so preview fields (`preview-field-*`) never collide with the live form's `field-*`.

## Back-compat and parity

No type change — `FormSection` already existed. Layout edits emit definitions that pass
`validateFormDefinition` and never implicitly delete a field, so already-replicated documents stay
valid. Saves run shared validation on both tiers; the preview still runs `validatePayload` (parity),
only suppressing its error UI. The M4 authoring spec passes unchanged (legacy studio testids preserved).

## Verification performed

```bash
npm run build                                       # tsc --noEmit + vite build
npm run test:unit                                   # form-layout engine (invariant after every op)
npx playwright test tests/e2e/layout-studio.spec.ts # reorder, sections, runtime grouping, DnD smoke
npx playwright test tests/e2e/authoring-studio.spec.ts  # no M4 regression
npm run test:e2e                                    # full suite
```

## Known limitations and risks

- Native drag-and-drop is smoke-tested, not a hard e2e gate (HTML5 DnD under Playwright is
  environment-sensitive); the accessible move controls are the real contract.
- Creating brand-new definitions from scratch is deferred (needs a server upsert path) — a candidate
  M12.
- The studio remains in `main.tsx` (the documented single-file shell); a split is deferred.
- Section authoring is form-only; view columns and workflow graphs are unchanged.
