# 03 — Modern tech stack, per pillar

Opinionated picks for an **offline-first, dual-authoring** Notes-class platform. Each row: the Notes
pillar, modern options, a recommended pick, and the tradeoff.

| Pillar | Options | Recommended | Tradeoff / note |
|---|---|---|---|
| **Schema-free datastore** | Postgres + JSONB/BSON · MongoDB · CouchDB/Couchbase | **Postgres** (relational envelope + JSONB/BSON payload) | One engine = ACID + relational + document + RLS + change-streams + FTS. The backbone. |
| **Sync substrate** *(the make-or-break)* | **PowerSync** (PG⇄SQLite) · **Couchbase/PouchDB + Sync Gateway** · ElectricSQL · RxDB · Realm/Atlas Device Sync | **PowerSync** if keeping Postgres; **Couchbase** if you want maximally Notes-native sync | PowerSync: bidirectional, server-authoritative upload queue, partial-sync "sync rules" that map to ACL — and keeps Postgres. Couchbase: revision-tree conflicts, mobile-first, NSF-philosophy, but leaves Postgres. **ElectricSQL pivoted to read-path-only sync in 2024** — less turnkey for multi-master writes now. |
| **Conflict resolution** | CRDT (Automerge/Yjs) · LWW + surface · domain merge | **CRDT/field-merge on payload + server-serialised state transitions** | Workflow transitions must reconcile through business rules, not blind merge. |
| **Expression engine** | **CEL** · JS sandbox (QuickJS/GraalJS) · JEXL (Java-only) | **CEL** *or* **JS sandbox** | Must run on client + server + offline replica with one dialect. JEXL is Java-only → wrong for offline parity. CEL has Go/Java/JS impls; JS-sandbox runs natively in browser and on server. |
| **Workflow engine** | Custom state machine · XState · Temporal · Camunda 8/Zeebe · Flowable | **Custom engine**, made portable; **Temporal** if flows get long-running/durable | Light document-routing → custom is plenty. Durable timers/sagas/human-in-loop → Temporal/Zeebe. |
| **Agents / automation** | Postgres `LISTEN/NOTIFY` · Debezium CDC · Temporal cron · Quartz · queues (NATS/Kafka/Redis Streams) | **CDC (Debezium) + worker pool** for triggers; **Temporal** for schedules | "On document change" = CDC; "on schedule" = durable cron. |
| **AuthZ (coarse + per-document)** | Postgres **RLS** · **OpenFGA/SpiceDB** (Zanzibar) · Cedar/OPA | **OpenFGA/SpiceDB** for relationship-based access, **doubling as the partial-sync filter** | Relationship model fits "who can see this doc"; the same policy drives replication scope. RLS is a simpler fallback. |
| **Identity** | **Keycloak** (OIDC) · Entra · Auth0 · LDAP/SCIM | **Keycloak** (self-host) | Needs cached, refreshable sessions for offline auth. |
| **Forms** | JSON form-schema + renderer (JSONForms / RJSF / Formily) · custom React renderer | **Form-schema (JSON) + custom React renderer** | Custom renderer needed for offline expression-driven hide/disable/validate. Render from the **local replica**. |
| **Views / lists** | AG Grid · TanStack Table · metadata→SQL generator | **Metadata-driven list defs → AG Grid/TanStack**, fed by local replica | Sort/filter on typed columns for index performance; works offline. |
| **Templates / promotion** | DB-stored versioned templates (extract/apply/diff) · GitOps definitions-as-code | **Both:** DB templates for citizen apps, definitions-as-code for developer apps | The modern `.ntf`; supports both authoring tiers. |
| **Full-text search** | Postgres FTS · Typesense · Meilisearch · OpenSearch | **Postgres FTS** to start; **Typesense/Meilisearch** when it grows | Offline search runs against the local replica (SQLite FTS). |
| **Client** | React/Vue/Svelte PWA · React Native · Flutter | **React PWA** (+ React Native later) | PWA for installable offline; native shell for deeper device sync. |
| **Deploy** | Containers + k8s · managed Postgres | **k8s; platform once; apps = promoted templates + plugins** | The "pack/deploy" model — unchanged by offline. |

## The recommended baseline (one coherent stack)

- **Postgres** (envelope + JSONB/BSON, RLS, CDC, FTS) as the authoritative core.
- **PowerSync** for Postgres⇄SQLite bidirectional offline sync with ACL-derived partial-sync rules.
- **CEL** (or a JS sandbox) as the single, portable, sandboxed expression dialect.
- **Custom workflow engine** (server-authoritative reconciliation; portable for Option A later).
- **Debezium/queue + Temporal** for agents and schedules.
- **OpenFGA** (or RLS) for per-document access *and* sync scoping.
- **Keycloak** (OIDC) for identity with offline sessions.
- **React PWA**: form-schema renderer + AG Grid, all reading the **local replica**.
- **Automerge/Yjs** field-level CRDT for payload merge (and optional co-editing).
- Apps promoted as **versioned templates + plugins**; platform on **k8s**.

## The three things that will eat the budget

1. **The low-code authoring experience.** The datastore is easy; the integrated, near-WYSIWYG
   "build form + view + workflow + permissions without leaving the platform," plus a **safe
   expression dialect with client/server/offline parity**, is the hard, differentiating ~80%.
2. **Replication + conflict resolution.** It is a fork, not a feature — it bends the whole stack.
   Choose the substrate via a spike *first* (see [05-build-sequence.md](05-build-sequence.md)).
3. **Per-document security at list/sync scale.** RLS + sorted, paginated, ACL-scoped lists + partial
   replication interact badly at scale. Design it in from day one.
