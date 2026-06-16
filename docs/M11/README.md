# M11 — Citizen Layout Studio

M11 completes Phase 8's citizen authoring tier: the form studio becomes a **visual layout editor** —
fields grouped into sections, reordered and re-grouped with accessible controls and drag-and-drop, with
a **live WYSIWYG preview**. This is the "then drag-and-drop" half of the vision's *"start schema-driven,
then drag-and-drop"* citizen studio (M4 delivered the schema-driven half; M7 the developer half).

M1–M10 proved the replica substrate, the metadata runtime, workflow, authoring, security, promotion,
the handler runtime, agents, search, and audit. M11 proves a citizen can shape a form's layout in-app —
no JSON — and see exactly what the runtime will render.

## Goal

- A section-grouped form studio: create/rename/reorder/remove sections; reorder fields within a section
  and move them between sections.
- Reordering via **accessible move-up/down buttons** (the testable contract) with **native HTML5 drag**
  as a progressive enhancement — **no new dependency**.
- All layout mutations route through a pure `src/shared/form-layout.ts` engine that keeps the form
  normalized (sections non-empty; every field in exactly one section).
- A **live preview** reusing the runtime `DocumentForm` in a read-only `preview` mode (true WYSIWYG).
- Local-first saves through the existing shared-validation `PUT /api/definitions` path — no server
  change.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, the DnD decision, non-goals |
| [02-studio-contract.md](02-studio-contract.md) | The layout engine, the normalized-form invariant, testids |
| [03-studio-runtime.md](03-studio-runtime.md) | The studio UI, preview, save flow |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M11 is the Notes form-designer experience re-centered on metadata: layout is data (`FormSection`), the
citizen arranges it visually, and the same renderer previews and runs it.

The working question is:

> Can a citizen shape a form's section layout visually — reorder and regroup fields, drag-and-drop —
> producing valid, back-compatible definitions, with a live preview that is exactly the runtime?
