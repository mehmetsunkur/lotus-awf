# ADR-0020: Actor-aware view filters (`@me`)

Date: 2026-07-03

## Status

Proposed — multi-lens `review-change` on this plan before building. Completes the
ADR-0018/0019 workflow arc: the engine stamps who owes action (`assignee`) and who may
act (`payload.approver`), but a view still cannot say "…and show *me* mine". M23
explicitly deferred this ("actor-aware `My` view filter DSL"); this ADR builds the
narrow version of it.

## Context

View filters are static data: `{ field, op, value }` with the value baked into the
definition at authoring time, translated by `mangoSelector` into a Mango selector. The
session exists only per request, so "assigned to the current user" is inexpressible —
today's `pending-approval` is a shared firehose everyone scans for their own name, and
`view:my-requests` is a lie (it lists everything the caller can read). Meanwhile the
per-request plumbing already exists one spread away: `accessSelector(scope)` injects the
caller's principals into every list query for `readers` filtering. `@me` is the same
move, generalized to an author-chosen field.

## Taxonomy

- Subsystem: Shared (validation), Server (selector build), Templates.
- Domain Area: Definitions-as-data (view contract), query & indexing, access control
  (adjacent — narrowing only).
- Change Type: Feature (definition-contract addition).
- Risk Class: Contract, index & query, ACL / readers (narrowing direction only).
- Runtime Surface: Internal API (the client renders what the API returns; no client
  logic change — the only client-side `filters` consumer is the ViewStudio editor).

## Decision

1. **Sentinel**: a view filter may use the reserved value `"@me"`, valid **only with
   `op: "in"`**, and only as the **entire** filter value — an array containing
   `"@me"` is rejected ("@me must be the entire filter value"), since the substitution
   matches the whole value, not elements (review M1a). Shared validation also tightens
   the op itself: `op: "in"` requires an array value **or** exactly `"@me"`, so
   near-miss typos (`"@Me"`, `" @me"`) fail at authoring time instead of becoming a
   malformed `$in` at query time (review M1b). At query time the server
   substitutes the caller's full principal set:

   ```jsonc
   { "field": "assignee", "op": "in", "value": "@me" }
   // → { assignee: { $in: principalsFor(scope) } }   // person + groups
   ```

   The `in` form covers both intended uses — a person-valued `createdBy` matches because
   `person:me ∈ principals`, and a group-valued `assignee` (the headless-department
   `group:managers` fallback) lands in **every** member's inbox.

2. **Substitution point** (corrected by review M5): there is exactly **one**
   `mangoSelector` caller — the app-scoped list route (`GET
   /api/apps/:appId/views/:id/documents`); unscoped requests are rejected by
   `appContextFromRequest` (ADR-0015). `mangoSelector` gains a **required**
   `principals` argument so any future caller must decide, and the route passes the
   scope it already computed. No engine, envelope, client, or MCP change — MCP reaches
   the same HTTP route through `lotus-client`, so `@me` resolves to the MCP session's
   authenticated user, never a service principal. **Fail-closed**: an empty principal
   set substitutes `$in: []` (matches nothing), and `$in` never matches an **absent**
   field — a submitted document without an `assignee` appears in nobody's personal
   inbox and remains reachable only via the shared worklist (review M8; asserted in
   the suite).

3. **Narrowing only, by construction**: the substituted predicate is AND-ed with the
   existing `accessSelector(scope)` and the JS `canReadDocument` post-filter — `@me` can
   hide readable documents, never reveal unreadable ones. The ACL invariant is untouched.

4. **Templates**:
   - leave-request gains **`view:my-approvals`** — `state == submitted`, `assignee in
     @me`: the personal inbox the assignee machinery was built for.
   - **`view:my-requests`** gains `createdBy in @me` — it becomes what its name claims.
   - **expense `view:my-expenses`** replaces its hardcoded seed-era readers filter
     (`["person:alice", "group:finance"]`) with `createdBy in @me` — the fossil `@me`
     was invented to replace.

5. **Reserved token**: a document whose data value is literally `"@me"` in a filtered
   field cannot be targeted by a filter for that literal. Accepted (Notes-style reserved
   `@`-name); the token is reserved only in filter values, never in payloads.

6. **Dead `readers`/`authors` filters rejected** (review M2): a `ViewFilter` on the
   `readers` or `authors` envelope fields has always been silently dead — the route
   spreads `accessSelector(scope)` over the same selector key *after* the view's
   filters, so the author's predicate never applies. Validation now rejects such
   filters at authoring time (the one shipped instance is the expense fossil this ADR
   removes). Already-deployed definitions with dead filters keep listing unchanged
   (validation runs on save, not read).

7. **Runtime floor / mixed versions** (review M3): view definitions are replicated
   data. A definition carrying `"@me"` that reaches a node running pre-ADR-0020 code
   renders `{ $in: "@me" }` — a Mango 400 on that view's list route (recognizable
   symptom). `@me` views therefore require every node at or above this build;
   pre-release, code and definitions roll together via the reseed policy (ADR-0019
   precedent). A capability/schema-version gate is deliberately out of scope.

8. **ACL precedence is pinned, not assumed** (review M4): a regression test asserts
   that a document whose `assignee` matches the caller but whose `readers` exclude the
   caller is absent from that caller's inbox — so a future refactor of the selector
   spread order or the `canReadDocument` post-filter fails a test instead of widening
   visibility.

## Performance

The `@me` predicate is the **same cost class as the ACL filtering every list query
already performs**. Mango executes these queries as: range-scan the hinted index
(`m3-docType-state-updatedAt` / `m2-kind-docType-updatedAt` prefix), load each row, apply
the remaining predicates in memory until `limit: 200` matches or the range is exhausted.
`readers: {$in: principals}` (accessSelector) is already such an in-memory predicate on
every query; `assignee/createdBy: {$in: principals}` is one more comparison on rows
already loaded — no additional I/O and no index-shape change.

The genuine risk is **selectivity vs. scan bound** (few matches in a large range forces a
long scan), bounded by two structural facts:

- The inbox range is **self-pruning**: `state == submitted` filters through the index
  prefix, and final states leave that range permanently — the scanned set is the open
  worklist, not history (the same reason `pending-approval` stays fast).
- `my-requests`-style views (no state filter) scan the whole docType range — exactly what
  today's unfiltered views already scan; `@me` changes which rows survive, not which rows
  are read.

Guards adopted:

- The e2e suite asserts via CouchDB `_explain` that the `my-approvals` selector still
  binds `m3-docType-state-updatedAt` — index binding is verified, not assumed; a silent
  fallback to `_all_docs` fails a test rather than degrading quietly.
- **Escape hatch (designed, deliberately not built)**: if inbox latency degrades at
  scale, the first response is a **partial index** — `assignee + updatedAt` with
  `partial_filter_selector: { state: "submitted" }` — indexing only the open worklist.
  Not built now: current scale doesn't need it, and the three-site index-sync invariant
  makes every index a standing liability. No benchmark is claimed at seed scale; the
  claim is structural.

## Alternatives considered

1. **Formula-valued filters** (a general filter DSL over the expression lane) —
   rejected: YAGNI; one sentinel solves the actual need, and a DSL invites per-request
   evaluation cost and a far larger validation surface.
2. **Client-side filtering** (fetch broad, filter to `@me` in the UI) — rejected: leaks
   the full worklist to every client, wastes the transfer, and diverges from the
   server-authoritative posture.
3. **Per-user generated views** (a view per person, Notes-style private views) —
   rejected: definition explosion, and the directory already gives us principals.

## Consequences

- Positive: real personal inboxes and honest `My` views with one substitution point; the
  ADR-0018 assignee gains its missing consumer; group-valued assignments fan out to
  member inboxes correctly.
- Negative: a reserved token in the filter-value space; one more per-request branch in
  selector construction.
- Neutral: no new Mango index (three-site rule untouched); ViewStudio's free-text value
  input already round-trips the sentinel.

## Acceptance sketch

- Unit: validation (`@me` accepted with `in`, rejected with every other op); substitution
  semantics (person + groups, empty scope → `$in: []`).
- E2E (airline): carol's `my-approvals` contains dave's submitted request while erin's is
  empty; hank's contains ivy's; a headless-department request appears in every manager's
  inbox (group expansion); `my-requests` lists only the caller's own documents;
  `_explain` confirms the inbox query binds `m3-docType-state-updatedAt`; existing
  expense/workflow/search suites stay green against the `my-expenses` cleanup.
