# 02 — Target architecture (offline-first / local-first)

Because **offline is a hard requirement**, the architecture is **local-first**: the data — and,
optionally, some of the logic — live on the client and reconcile with the server on sync. This is a
different center of gravity from a conventional server-authoritative app, and it must be designed in
from the start, not added later.

## The decision that shapes everything: where does the engine run offline?

In Notes, formulas and agents ran on whichever replica you were on. The modern equivalent is a fork:

- **Option A — Optimistic local engine (true Notes-like).** Form logic *and* the state machine run
  on the client against the local replica. You create, edit, validate, **and advance workflow state
  offline**; the server re-validates and reconciles on sync. Most powerful; hardest — the engine must
  run on-device (JS/WASM) and you must handle the server rejecting an optimistic transition.
- **Option B — Offline data, online workflow.** Documents and forms are fully offline (create / edit
  / save / validate drafts); **state transitions require connectivity** and queue until sync. Much
  simpler; covers the dominant real case (fill forms offline → sync → approvals run server-side).

**Recommended posture:** build an **A-capable substrate**, ship **B-by-default**. Keep the engine
portable enough to push to the device later, but at launch reconcile transitions server-side.

## Component diagram

```
┌──────────────────────── CLIENT (local-first PWA / React Native) ────────────────────────┐
│  Form renderer + client expression engine  (offline hide / disable / validate)           │
│  View / list renderer ── reads ──▶ LOCAL REPLICA (SQLite or PouchDB/IndexedDB)            │
│  Optimistic workflow engine (Option A; portable JS/WASM) ─writes─▶ local replica + OUTBOX │
│  Sync client: bidirectional replication · conflict surfacing · ACL-scoped partial pull    │
└───────────────────────────────────────────▲──────────────────────────────────────────────┘
                                             │  sync protocol (delta, resumable, offline queue)
┌──────────────────────────── SYNC LAYER ────┴──────────────────────────────────────────────┐
│  Replication substrate (PowerSync / Couch Sync Gateway):                                   │
│    upload queue · conflict policy · PARTIAL-SYNC rules derived from AuthZ                   │
│    ("you only replicate what you may read" — Notes reader-field scoping, modernised)        │
└───────────────────────────────────────────▲──────────────────────────────────────────────┘
┌──────────────────────── PLATFORM CORE (deployed once) ─────────────────────────────────────┐
│  Authoritative store  (Postgres: relational envelope + JSONB/BSON payload)                  │
│  Workflow engine      (authoritative re-validation / reconciliation of transitions)         │
│  Definition store     (forms / views / workflows / ACL — versioned)                         │
│  Expression engine    (server-side, same dialect as client)                                 │
│  AuthZ (RLS / OpenFGA) ── also emits the partial-sync rules                                  │
│  Agents runtime       (scheduled + CDC-triggered automation)                                │
│  Identity (OIDC / Keycloak)   Process-plugin runtime (developer code)   Template/promotion   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── AUTHORING ──────────────────────────────────────────────────────────┐
│  Citizen tier:  low-code studio (form / view / workflow builders) → writes definitions (data) │
│  Developer tier: definitions-as-code SDK + CLI (Git/CI) + plugin SDK (compiled, reviewed)     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## How the hard parts work

**Conflict resolution.** Blind last-write-wins is wrong for workflow. Split it:
- **Payload fields** → field-level merge; use a CRDT layer (Automerge/Yjs) if co-editing matters,
  else deterministic merge with conflicts surfaced.
- **State transitions** → never blind-merge; serialise them through the **server engine** so two
  offline advances reconcile via business rules. Expose a Notes-style "resolve conflict" surface for
  what can't auto-settle.

**Partial, ACL-scoped replication.** The same policy that answers "who can read this document"
defines "what replicates to this device." One source of truth for **access and sync scope** — this
is the modern form of Notes reader-field-scoped replication.

**Offline identity & numbering.**
- Document identity: **client-generated UUIDv7 / ULID** so offline-created docs never collide.
- Human-readable sequence numbers (job numbers, invoice numbers): **allocated lazily on first sync**
  (server-authoritative) — sequences cannot be allocated offline without collision.

**Expression parity.** The *same* safe, sandboxed expression dialect must run on **client, server,
and local replica** (offline form UX + optimistic transitions). This rules out single-language-only
engines; see [03-tech-stack.md](03-tech-stack.md).

## Data model (carried from the ABPM learnings)

Each document = a **relational envelope** (type, owner, ACL arrays, state, dates, version) + a
**schema-free payload** (JSONB/BSON). The engine and security touch only the typed envelope columns,
so payload shape-drift can't break them; lists sort/filter on typed envelope columns (never raw JSON)
for index performance. This model works unchanged in a local-first world.

## Packaging & deployment (unchanged by offline)

The **platform** is deployed once (containers/k8s) — analogous to standing up the Domino *server*. An
**app is not a binary**: it is a **versioned definition template** (forms/views/workflows/ACL) plus
optional developer **plugins**. Promotion dev → test → prod = template extract → apply (as a new
immutable version) → diff → bind to environment. This is the modern `.ntf` design-refresh.
