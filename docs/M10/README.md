# M10 — Audit & Retention

> **Amended by ADR-0026 (2026-10-19):** per-document `readers` (and the M5 revocation purge) were removed — document visibility is the app ACL. Readers-based statements below are historical; see `docs/decisions/0026-app-acl-document-visibility.md`.

M10 gives the platform an **audit trail**: a durable, ACL-scoped record of who changed what and when,
recorded server-authoritatively from the change feed, with a retention policy that ages events out.
This is the first slice of the vision's Phase 9 "hardening" bundle (the remaining Phase-9 item after
promotion (M6), agents (M8), and search (M9)).

M1–M9 proved the replica substrate, the metadata runtime, workflow, authoring, security, template
promotion, the plugin/handler runtime, agents, and search. M10 proves the same CDC + definitions-as-
data posture can deliver an audit trail that is **offline-correct** (it captures replicated edits) and
**ACL-correct** (it never widens visibility), without new substrate.

## Goal

- A CDC-driven, server-authoritative audit recorder (`runAudit()`), mirroring the M8 agent tick:
  drain `_changes` since an `audit:state` checkpoint, write durable `auditevent:*` per business
  create/update, deduped by `docId@rev`.
- **Deletes** recorded best-effort at the API delete path (the feed has no deleted body).
- **Policy as data**: a singleton `audit:policy` design doc (`retentionDays`, optional `docTypes`),
  templated like `acl:rules`; pure decisions in `src/shared/audit.ts`.
- **Retention** via tombstone `DELETE` (replicates the prune), distinct from M5 `_purge`.
- Audit visibility mirrors the source document's `readers`; `GET /api/audit` is principal-scoped.
- A read-only audit-trail panel in the runtime UI.
- No new Mango index; no new infrastructure.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary, the recorder decision, non-goals |
| [02-audit-contract.md](02-audit-contract.md) | Policy, event, checkpoint shapes; matcher semantics; API |
| [03-audit-runtime.md](03-audit-runtime.md) | The tick, retention, ACL ordering, the UI |
| [04-build-plan.md](04-build-plan.md) | Implementation steps |
| [05-acceptance.md](05-acceptance.md) | Demo flow and exit criteria |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

M10 is the modern Notes change-history substrate, not a SIEM.

The working question is:

> Can a CDC recorder produce a durable, ACL-scoped audit trail that captures replicated offline edits
> and prunes on a retention policy, server-authoritatively, without new substrate or leakage?
