# 03 - Acceptance

Verified by `npm run test:unit` (template registry) and `npm run test:e2e`
(`tests/e2e/scenario-agentic-airlines.spec.ts`).

- `sample:leave-request` loads from the registry as design docs plus separate sample data,
  passes template validation, and appears in `availableTemplates`.
- The fixture seeds the airline through public APIs only and can run repeatedly within one
  worker (per-seed appIds survive `/api/reset` leftovers).
- A staff persona sees exactly the airline org chart — three departments, five employees with
  correct manager chains — and none of the org template's admin-only sample data.
- An employee's leave request travels `submit → approve` via their manager's session; the
  approval worklist lists it; the audit trail is visible to a manager and not to an unrelated
  employee.
- A manager can reject a submitted request.
- Isolation: a peer in another department can neither list nor directly read a request
  (403/404); the requester cannot self-approve (422); a `group:managers` persona can.
- The same personas work the expense app: crew files an expense (computed `gross` runs),
  a non-finance persona cannot approve (422), finance approves, and the document stays
  invisible to unrelated personas.
