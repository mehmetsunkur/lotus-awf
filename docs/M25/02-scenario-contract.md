# 02 - Scenario contract

## Leave-request template (`templates/leave-request/*`)

`sample:leave-request` follows the expense template's shape exactly:

- `form:leave-request` — `type` (select: annual/sick/unpaid), `from`/`to` (dates, `to >= from`
  validated), `reason` (textarea, required, searchable). `defaultReaders: ["group:managers"]`
  so the approver group can read submitted requests (ADR-0015 mechanism, mirroring the expense
  form's `group:finance`).
- `workflow:leave-request` — `draft → submitted → approved/rejected`; `submit` guards on the
  date range and runs the `audit-transition` effect; `approve`/`reject` require
  `group:managers`.
- Three views, all sorting on `updatedAt` and binding the existing Mango indexes (no new
  index): `view:my-requests` (docType + `createdBy in @me` — the caller's own requests),
  `view:my-approvals` (ADR-0020 personal inbox: docType + `state == submitted` +
  `responsible in @me` — the pool this state routes to; ADR-0025 renamed the routing field
  from `assignee`, which is now the separate individual owner; index binding verified via
  `_explain` in the suite), and
  `view:pending-approval` (the shared worklist: docType + `state == submitted`).
- `acl:rules` grants `group:admins` manager, `group:managers` editor, `group:employees`
  author. The groups are a convention the deploying environment supplies (the airline fixture
  intentionally does not create `group:employees` — see ACL design below).
- Sample data: two requests (one draft, one submitted), each readable by its requester and
  `group:managers` only.

## Fixture (`tests/e2e/support/scenario-agentic-airlines.ts`)

`seedAgenticAirlines(admin)` seeds on top of the per-test `/api/reset` state through public
HTTP APIs only (names.nsf directory, `POST /api/platform/apps { fromTemplate }`, M22 access
editor, app-scoped documents), so ACL, validation, and session invariants are enforced while
seeding. It returns an `AirlineScenario` handle: personas, deployed appIds, and created org
document ids. `airlinePersonaContext(playwright, baseURL, username)` opens an independent
authenticated cookie-jar context per persona (the `bobApi` pattern).

- Personas: carol (Director of Flight Operations), dave (First Officer → carol), erin (Cabin
  Services Manager → carol), frank (Senior Cabin Crew → erin), hank (Ground Operations
  Supervisor — a head deliberately outside `group:managers`), ivy (Ramp Agent → hank), grace
  (Finance Controller — top-level head). Directory groups: `managers`, `flight-ops`, `cabin-crew`; grace is added to the
  existing `finance` group so she can approve expenses.
- Org chart: three departments (each carrying its `head` — the single source of truth for
  reporting lines) and five employee documents, created by the admin after widening the org
  forms' `defaultReaders` to the staff groups; the org template's admin-only sample data
  stays untouched and invisible to personas. An employee's manager is not stored: the org
  template's `manager` formula field derives it via `@DbLookup` (department `head`, or the
  parent department's head for a head — e.g. erin → carol via `cabin-crew.parent`).
  ADR-0019 landed (superseding ADR-0017's gate): the leave-request form stamps
  `payload.approver` (a `computed` field — the requester's department head, parent-walk
  for heads, `group:managers` only for a genuinely headless department) and
  `payload.department` (`computed-once`, the filed-under department) at every save, with
  client-supplied values discarded on all three write paths; approve/reject gate with the
  guard `principals.includes(payload.approver)` (no `requiredRole`), and the workflow's
  `responsibleFormula: "payload.approver"` feeds the ADR-0018/0025 `responsible` set (the
  pool routing field; the individual `assignee` is unused by this scenario). The fixture
  re-points the FORM's formulas to the per-seed org appId. Ground Operations exists
  precisely to break the head ∈ managers assumption: hank heads it without
  `group:managers` membership, and ivy reports to him.
- **Per-seed appIds**: `/api/reset` recreates the directory/platform databases but leaves
  earlier business-app databases behind, so a fixed appId would 409 on the second seed in a
  worker. Each seed deploys the templates under `org-s<n>` / `leave-request-s<n>` — templates
  are appId-agnostic (ADR-0016), and the scenario handle carries the ids.
- The platform `orgName` stays the reset default ("Development Org"); the airline identity
  lives in the directory and app data.

## ACL design

`readersForNewDocument` stamps a new document with the creator's **full principal set**
(person + all their groups) plus the form's `defaultReaders`. A shared all-staff group would
therefore make every leave request readable by every employee. Personas belong only to their
department group (plus `managers` where applicable), and app access for departments is granted
through the M22 access editor. Isolation is asserted across departments — the platform's
actual granularity.
