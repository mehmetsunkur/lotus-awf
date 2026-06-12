# 06 — References, prior art & build-vs-buy

## Closest modern "Notes-like" platforms (study these)

- **Frappe Framework** (frappeframework.com) — the closest open-source spiritual successor as a
  *full app platform*: metadata-driven "DocTypes" (= forms + schema), list views, permissions,
  workflow, server scripts, report builder. Worth studying deeply even if not adopted. (No
  offline/local-first, though.)
- **Couchbase / CouchDB + PouchDB / Sync Gateway** — the closest *technical* heir to NSF replication.
  CouchDB was created by **Damien Katz, who previously worked on Lotus Notes at IBM**; the
  replication/offline philosophy is directly descended from Notes. Couchbase Lite + App Services give
  mobile offline sync out of the box.
- **HCL Domino (current)** — Notes/Domino still exists, modernised: a **Domino REST API**, the
  **Volt MX** low-code layer, and Nomad web client. The incumbent's own modernisation path is a
  useful reference for what they kept.

## Local-first / sync technology

- **PowerSync** — Postgres (and others) ⇄ SQLite bidirectional sync; server-authoritative upload
  queue; partial sync via "sync rules." Strong fit if keeping Postgres.
- **ElectricSQL** — Postgres sync; **pivoted in 2024 to read-path "shapes"** (writes go through your
  API), so less turnkey for multi-master write-sync than its earlier incarnation. Re-evaluate
  current capabilities at decision time.
- **RxDB** — client-side reactive DB with pluggable replication (CouchDB/GraphQL/custom).
- **Realm / MongoDB Atlas Device Sync**, **Ditto** — commercial device-sync options.
- **CRDTs: Automerge, Yjs** — conflict-free merge for JSON/text; the basis for collaborative editing
  and field-level merge.

## Expression / rules engines

- **CEL (Common Expression Language)** — Google; sandboxed, non-Turing-complete; impls in Go
  (canonical), Java, and JS/TS ports — good for client/server/offline parity.
- **JS sandboxes: QuickJS, GraalJS** — familiar dialect; need hardening for citizen-authored code.
- **Apache Commons JEXL** — Java-only (what ABPM uses); convenient on the JVM but **not portable to
  the client/offline** — a poor fit here.

## Workflow engines

- **Temporal** — durable execution; long-running orchestrations, timers, retries, sagas.
- **Camunda 8 / Zeebe**, **Flowable** — BPMN engines.
- **XState** — lightweight state machines (incl. client-side).

## AuthZ

- **OpenFGA / SpiceDB** — Google Zanzibar-style relationship-based access ("who can see this doc"),
  ideal for per-document security that also scopes replication.
- **Postgres RLS** — simpler row-level fallback.
- **Cedar / OPA** — policy-as-code engines.

## Low-code / internal-tool platforms (for comparison)

- **Appian, OutSystems, Mendix** — enterprise low-code (the "professional + citizen" model done at
  scale).
- **Budibase, Appsmith, ToolJet, Retool** — open-source / internal-tool builders.
- **NocoDB, Baserow, Teable, SmartSuite, Zoho Creator** — Airtable-class schema-flexible app builders.

## Build vs. buy posture

Three honest paths:
1. **Adopt a base** (Frappe, or Couchbase for the sync core) and build the workflow/authoring on top
   — fastest to a Notes-like feel.
2. **Assemble best-of-breed** (the [03-tech-stack.md](03-tech-stack.md) baseline) — most control over
   engine/security/forms; the right call when workflow semantics and per-document ACL are the point.
3. **Hybrid** — Couchbase/PowerSync for the sync substrate, custom engine + authoring on top.

The differentiator is never the datastore — it's the **integrated authoring experience + offline
sync + per-document security working together**. Buy the commodities; build the integration.
