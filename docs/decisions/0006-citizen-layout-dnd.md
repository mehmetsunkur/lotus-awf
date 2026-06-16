# ADR-0006: Citizen layout studio — accessible reorder first, native drag as enhancement

Date: 2026-06-16

## Status

Accepted

## Context

Phase 8 of the vision is dual authoring: a citizen low-code studio that "starts schema-driven, then
drag-and-drop." M4 delivered the schema-driven half (structured field/view/workflow editing); M7
delivered the developer half. The remaining gap is **visual layout authoring** — reordering fields and
organising them into sections — which the build sequence flags as the critical path most likely to
slip. The runtime renders a form by section (`DocumentForm`), so layout is encoded in `FormSection`,
which the studio did not expose. The project is deliberately dependency-light (React, Express, CouchDB
client, `ulid` — no UI/DnD libraries).

## Taxonomy

- Subsystem: Client + Shared
- Domain Area: Authoring / studio
- Risk Class: UX / test-flakiness (not substrate)
- Runtime Surface: Studio UI

## Decision

Implement reordering with **accessible move-up/down buttons and a move-to-section control as the
primary mechanism** (the "schema-driven" reorder), and layer **native HTML5 drag-and-drop** on top as a
progressive enhancement over the same operations. **No drag-and-drop library is added.** All layout
mutations route through a pure `src/shared/form-layout.ts` engine that keeps the form normalized
(sections non-empty; every field in exactly one section), so the logic is deterministic and
unit-tested. The studio gets a **live WYSIWYG preview** by reusing the runtime `DocumentForm` in a
read-only `preview` mode. Creating brand-new definitions from scratch is **deferred to a later
milestone** (it needs a server upsert path); M11 edits existing forms, client-only.

The **e2e contract is the accessible controls** (deterministic); native drag gets a single
non-blocking smoke, because HTML5 DnD under Playwright is environment-sensitive.

## Alternatives Considered

1. **dnd-kit / react-dnd** (rejected for M11): nicer drag UX and a11y, but the first runtime-UI
   dependency in a deliberately lean stack; revisit only if native DnD proves insufficient.
2. **Native DnD as the only reorder mechanism** (rejected): poor accessibility and flaky to test —
   leaves keyboard users and the e2e suite without a reliable path.
3. **Move-buttons + native DnD enhancement, logic in shared (chosen)**: zero dependencies, accessible,
   deterministically testable, and the pure engine makes the rules unit-verifiable.

## Consequences

- Positive: no new dependency; accessible and keyboard-operable; deterministic e2e; layout rules are
  pure and unit-tested; the preview reuses the real renderer (true WYSIWYG, validation parity).
- Negative — known debt: native DnD is only smoke-tested (not a hard gate); create-from-scratch is
  deferred; `main.tsx` grows (kept single-file by the documented client convention rather than split).

## Follow-Ups

- Create-new-definition path (needs a server upsert/POST) — a candidate M12.
- Optionally adopt dnd-kit if drag UX/a11y needs outgrow native DnD.
- Consider splitting the studio out of `main.tsx` if the single-file shell becomes unwieldy.
