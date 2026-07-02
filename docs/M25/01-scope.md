# 01 - Scope

## In scope

- A third bundled template, `sample:leave-request` (`templates/leave-request/*`): leave form
  (type/from/to/reason), `submit → approve/reject` workflow gated on `group:managers`,
  `view:my-requests` and `view:pending-approval`, ACL, audit policy, and sample data.
- A reusable e2e scenario fixture (`tests/e2e/support/scenario-agentic-airlines.ts`) that
  seeds Agentic Airlines PLC on top of `/api/reset` through public HTTP APIs only: five
  personas and their directory groups in names.nsf, org + leave-request apps deployed from
  bundled templates under per-seed appIds (ADR-0016), org-chart documents with manager
  chains, and M22 access-editor grants for the airline groups.
- Scripted-persona e2e specs (`tests/e2e/scenario-agentic-airlines.spec.ts`) driving
  multi-user workflow, ACL isolation, and audit scoping through independent authenticated
  session contexts.

## Out of scope

- AI-agent personas over the MCP surfaces (follow-up tier; see `docs/context/mcp.md`).
- Server/runtime behavior changes — the platform substrate is exercised, not modified.
- Per-manager approval routing (the workflow gate is a single `group:managers` principal,
  matching the expense template's `group:finance` granularity).
- Deploy-artifact test coverage of the new template (`tests/deploy/` already proves the
  bundled-template mechanism for two templates).
- Changes to `/api/reset` cleanup semantics (leftover app databases are sidestepped by
  per-seed appIds; see `02-scenario-contract.md`).

## Taxonomy

- Subsystem: Server (template registry entry, `templates/**`), e2e tests.
- Domain Area: App lifecycle, access control, identity & sessions, definitions-as-data.
- Change Type: Feature (additive).
- Risk Class: ACL/readers, identity & sessions, contract/back-compat.
- Runtime Surface: Internal API.
