# 04 — Build Plan

## Step 1 — Contract + pure engine

Add `AuditPolicy` (design), `AuditEvent` + `AuditState` (runtime), and `AuditAction` to
`src/shared/types.ts`; add `AuditPolicy` to the `DesignDocument` union. Add `src/shared/audit.ts`
(`auditAction`, `shouldAudit`, `eventIsExpired`) and `validateAuditPolicy` in the shared definition
validator dispatch. Unit-test.

## Step 2 — Server runtime + plumbing + seed

Add `loadAuditPolicy`/`loadAuditState`/`runAuditOnce`/`runAudit` (CDC drain, dedupe by `docId@rev`,
checkpoint, tombstone retention prune) and `recordDeleteAudit` (best-effort at the API delete path).
Add `POST /api/audit/run` and `GET /api/audit` (principal-scoped). Include `audit:policy` in
`currentDefinitions` and template validation; seed it. Fold audit into the optional agent interval.
No new Mango index.

## Step 3 — Client panel + e2e

Add the read-only audit-trail panel to `src/client/main.tsx` (fetch `GET /api/audit?docId=` on
selection). Add `tests/e2e/audit.spec.ts`: record + idempotent, ACL scoping (Bob vs Alice), retention
prune, delete auditing + panel render.

## Step 4 — Docs

Add these M10 docs and `docs/decisions/0005-audit-via-cdc-and-tombstone-retention.md`; add the Audit
invariant (with `Paths:`); reconcile the `docs/context/*` cards and bump their baselines.

## Step 5 — Verify

`npm run build`, `npm run test:unit`, `npm run test:e2e`; run the Tier-3 multi-lens review on the M10
range (this touches the definition contract + replication semantics).
