# 03 - Acceptance

Verified by `npm run test:unit` (template registry) and `npm run test:e2e`
(`tests/e2e/scenario-agentic-airlines.spec.ts`).

- `sample:leave-request` loads from the registry as design docs plus separate sample data,
  passes template validation, and appears in `availableTemplates`.
- The fixture seeds the airline through public APIs only and can run repeatedly within one
  worker (per-seed appIds survive `/api/reset` leftovers).
- A staff persona sees exactly the airline org chart — three departments, five employees with
  correct manager chains — and none of the org template's admin-only sample data.
- An employee's leave request travels `submit → approve` via **their department head's**
  session; the approval worklist lists it; the audit trail is visible to a manager and not to
  an unrelated employee. (ADR-0017 rewrote this criterion: approval is routed by
  `department.head`, so a `group:managers` persona who is NOT the requester's head is refused
  with 422 and the designated-approver message; a head outside `group:managers` CAN approve;
  a headless department falls back to the static `group:managers` gate.)
- The requester's department head can reject a submitted request (same routing as approve).
- Isolation: a peer in another department can neither list nor directly read a request
  (403/404); the requester cannot self-approve (422).
- ADR-0018: submitting stamps the resolved head (or `group:managers` when headless) as the
  document's `assignee` with `assignedAt`; entering a final state clears both; `history[]`
  records each hand-off.
- The same personas work the expense app: crew files an expense (computed `gross` runs),
  a non-finance persona cannot approve (422), finance approves, and the document stays
  invisible to unrelated personas.
