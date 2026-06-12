# 00 — Vision

## The thesis

Lotus Notes/Domino delivered something most modern stacks have lost: a **single, coherent platform**
where one person could build and ship a complete application — data, forms, views, automation,
security, and distribution — without assembling a dozen separate systems. An app was an `.nsf` file;
you dropped it on a server (or replicated it to a laptop) and it ran, offline included.

We are not rebuilding the *product* Notes was (email + groupware + client). We are rebuilding the
**application-platform model** underneath it, modernised:

- documents are schema-free,
- forms and views are **metadata, not code**,
- logic is **expressions + pluggable handlers**,
- security is **per-document**, not just per-table,
- apps **replicate and run offline**,
- and an app is **promoted as a versioned template**, not deployed as a bespoke binary.

## Why now / why this is worth building

- The "unbundling" of the last 15 years (separate DB, separate form builder, separate workflow
  engine, separate auth, separate sync) means teams re-solve the *integration* on every project. A
  re-integrated platform collapses that cost.
- **Local-first** technology has finally matured (CRDTs, Postgres⇄SQLite sync, mobile sync gateways)
  to make Notes-style offline practical again without IBM-era infrastructure.
- A **dual-tier** (citizen + developer) model fits how organisations actually build internal apps —
  power-users prototype, developers harden and integrate.

## Goals

1. **App-in-a-box:** define data + forms + views + workflow + security + deploy from inside the
   platform.
2. **Offline-first:** full read/write while disconnected; deterministic sync and conflict handling.
3. **Dual authoring:** low-code for citizens, definitions-as-code + plugins for developers, fully
   interoperable.
4. **Per-document security** that also governs *what replicates to whom*.
5. **Promotion as templates:** author once, promote dev → test → prod as a versioned artifact.

## Non-goals (at least initially)

- Not rebuilding Notes Mail / calendaring / the groupware suite.
- Not a real-time collaborative *editor* product (CRDT co-editing is a capability, not the point).
- Not a general BaaS — the unit of value is the **workflow application**, not raw tables.
- Not bound to legacy Notes formula/LotusScript compatibility — we keep the *model*, not the dialect.

## Success criteria (north star)

A power-user builds a multi-state approval app — forms, a worklist view, ACL, a couple of validation
rules — entirely in the studio; a developer adds one integration via the plugin SDK; the app is
**used offline in the field**, syncs without data loss (including a conflicting edit resolved
sanely), and is **promoted to production as one versioned template** with no manual reconfiguration.

## Relationship to the ABPM project

This brief was distilled while comparing Notes to the ABPM workflow engine (a separate repo). ABPM
contributes proven, reusable ideas — relational-envelope + schema-free-payload data model, a
workflow-engine semantics, ACL authority arrays, application templates — but ABPM is
**server-authoritative and online-only**. The offline-first requirement here is a genuine
re-centering, not an extension. See [04-key-decisions.md](04-key-decisions.md) for the
"extend vs. fork" question.
