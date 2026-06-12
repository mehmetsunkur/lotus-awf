# 04 — Key decisions & open questions

Decisions taken in the founding discussion, decisions still owed, and the assumptions behind them.

## Decided

### D-1 — Offline / replication is a hard requirement
The platform is **local-first**: full read/write offline, deterministic sync, explicit conflict
handling. *Consequence:* every other choice (datastore, expression engine, where the engine runs,
security) bends around this. It is not retrofittable.

### D-2 — Dual authoring: developers **and** citizen/power-users
Two interoperable tiers:
- **Citizen/power-user:** low-code studio (form/view/workflow builders), **declarative sandboxed
  expressions**, no compilation. Definitions are data.
- **Developer:** definitions-as-code (Git/CI), a **plugin SDK** for custom handlers/integrations,
  custom renderers. Compiled, reviewed, versioned.
A citizen app must be able to call a developer-provided plugin; definitions must round-trip between
visual and code form. *Consequence:* expressions must be **safe/sandboxed** (citizens write them) and
**portable** (client + server + offline).

## Owed (decide before committing)

### Q-1 — Where does the engine run offline? *(unblocks the next concrete step)*
**Option A** optimistic local engine (advance workflow offline) vs **Option B** offline data /
online transitions. Recommended posture: **A-capable substrate, B-by-default at launch.** This
single choice decides whether the expression engine and workflow must be fully portable to the
device now, or whether the server stays the only place transitions run.

### Q-2 — Sync substrate: Postgres-with-sync vs Couch-native
**PowerSync on Postgres** (keep the relational/JSONB/RLS backbone, add bidirectional sync) vs
**Couchbase/CouchDB** (sync as a first-class native capability, doc-DB tradeoffs). Decide by
**spike**, not on paper (see [05-build-sequence.md](05-build-sequence.md) Spike 0). Lean: Postgres +
PowerSync *if it survives the spike*, because it preserves the most prior art.

### Q-3 — Expression dialect: CEL vs JS-sandbox vs other
Both run on client + server + offline. CEL = safer/more constrained, multi-language, no Turing
completeness; JS-sandbox = more familiar to authors, needs hardening (QuickJS/GraalJS). Affects
citizen-author ergonomics vs. safety.

### Q-4 — Conflict model granularity
Field-level CRDT auto-merge everywhere vs CRDT-on-payload + server-serialised transitions vs
document-level last-write-wins with a manual resolve queue. Recommended: the middle option; confirm
against real conflict scenarios in Spike 0.

### Q-5 — Identity & offline trust
OIDC (Keycloak) with cached offline sessions — but how long may a device operate offline, and how are
permissions revoked for a device that hasn't synced? (Notes solved this with ID files + cert expiry;
we need the modern equivalent.)

### Q-6 — "Extend ABPM" vs "fork a new product"
ABPM contributes the data model, engine semantics, ACL arrays, and template idea — but is
server-authoritative and online-only, and its expression choice (JEXL, Java-only) is wrong for
offline parity. Decide: **extend** ABPM toward local-first (keep Postgres, add PowerSync, swap the
expression engine, add sync/conflict) **or** treat this as a **distinct product** reusing ABPM's
*ideas* but not its runtime. Lean: extend, conditional on Q-2's spike.

### Q-7 — Scope of the citizen tier
How much WYSIWYG? A form/view/workflow builder is a large surface. MVP could be schema-driven
("define the JSON, get a rendered form") before full drag-and-drop. Decide the citizen MVP boundary.

## Assumptions (validate later)

- A relational-envelope + schema-free-payload model is the right document shape (carried from ABPM;
  proven there for a centralised case — re-validate under sync).
- Per-document ACL can also serve as the partial-replication filter without a second policy system.
- Most field/offline workloads are **B** (data offline, transitions online); **A** is a later
  premium capability, not the launch requirement.
- Team has full-stack capacity; timeline is the constraint, not skills. (Mirror of ABPM's posture —
  re-confirm for this project.)

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Sync substrate can't do ACL-scoped partial sync + sane conflict handling at scale | Invalidates the whole local-first premise | **Spike 0 is a go/no-go** before any engine work |
| Low-code authoring scope underestimated | The differentiating 80% slips | Treat as critical path; start schema-driven, prototype early |
| Expression dialect not truly portable | Offline form UX / optimistic transitions break | Pick a multi-runtime dialect (CEL/JS) up front; server stays authoritative |
| Per-document security + pagination + partial sync interact badly | Cripples lists/inbox at scale | Design security + list + sync together, not separately |
| Offline ID / sequence collisions | Data corruption on sync | Client UUIDv7/ULID identity; lazy server-side human-readable numbering |
| "Extend vs fork" left ambiguous | Wasted work, hybrid that satisfies neither | Resolve Q-6 right after Spike 0 |
