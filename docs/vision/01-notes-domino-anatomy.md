# 01 — Anatomy of Notes/Domino: the key functions

Notes/Domino (Lotus 1989 → IBM → HCL since 2019) decomposed into the functional pillars a modern
rebuild must cover. For each: *what it did* and *why it mattered*.

## 1. The NSF — schema-free document datastore *and* the unit of an app
The `.nsf` file held **both data and design** (documents, forms, views, agents, ACL) in one
container. It was a document store (NoSQL before the term): documents are bags of named items/fields
with **no fixed schema** — two documents in the same database can have completely different fields.
*Why it mattered:* the app and its data were one portable, replicable thing.

## 2. Forms — declarative data entry/display
A form defined how a document is created, edited, and displayed: computed fields, default-value
formulas, **hide-when** conditions, input validation, subforms/shared fields. Data lived on the
document; the form rendered it (and the form used to *display* could differ from the one used to
*create*). *Why it mattered:* this declarative form layer is the soul of Notes — the thing
power-users actually built.

## 3. Views — metadata-driven lists/reports
A view = a **selection formula** (which documents) + columns with sort/categorise/column-formulas;
folders too. *Why it mattered:* lists/worklists/reports were configuration, not code.

## 4. Formula + scripting — computation and automation
Two tiers: **@Formula** (declarative — computed fields, selections, lookups like `@DbLookup`) and
**LotusScript / Java / JavaScript** (procedural — complex logic). *Why it mattered:* a low-code
ramp (formulas) with a pro escape hatch (script) — the original dual-authoring model.

## 5. Agents — scheduled & event-triggered automation
Background logic: "on schedule," "on document change/create," "before new mail arrives." Workflow was
often agents moving documents through status fields. *Why it mattered:* the automation/workflow
engine.

## 6. Workflow / routing
Documents advancing through states/status fields, mail-enabled forms, approvals. Notes was famous for
workflow apps. *Why it mattered:* the core business pattern the platform existed to serve.

## 7. Security — coarse ACL + per-document fields
Database-level **ACL roles and levels**: Manager, Designer, Editor, Author, Reader, Depositor,
No Access — **plus Reader/Author fields on individual documents** for true row-level security. *Why
it mattered:* per-document visibility is what relational apps usually get wrong; Notes had it native,
and it scoped **replication** too.

## 8. Replication — multi-master sync + offline
Server↔server and server↔local-client replicas synced **field-by-field**, with conflict handling
(Notes kept "replication conflict" documents). You worked offline on a laptop and replicated later.
*Why it mattered:* the killer feature and the hardest pillar to reproduce.

## 9. Templates (`.ntf`) — design inheritance & refresh
A database could **inherit its design from a master template**; a *design refresh/replace* pushed
design changes to every `.nsf` that inherited from it. *Why it mattered:* the packaging/promotion
model — update the template, every deployed app updates.

## 10. Directory & identity
Notes ID files, hierarchical naming (`CN=…/OU=…/O=…`), X.509-style certificates, the Domino
Directory. *Why it mattered:* identity and trust were built in.

## 11. Mail / messaging
Notes was also the email client; forms could be mail-enabled to route. *Why it mattered:*
communication was part of the platform, not bolted on.

## 12. Full-text search, clustering, admin, the client
FT indexing per database; Domino clustering/HA; a rich client plus, later, **XPages** (~2009, a
JSF-based web framework over NSF data — a direct cousin of modern JSF/PrimeFaces apps).

---

## The pattern to preserve vs. the physics to drop

**Preserve (the logical model):** schema-free documents · forms-as-metadata · views-as-metadata ·
expressions + pluggable logic · per-document ACL · templates/promotion · offline replication.

**Drop / modernise (the physics):** the single-file NSF, the proprietary Notes ID/PKI, the rich
client, LotusScript, and IBM-era server infrastructure. We keep the *experience*, not the
implementation.
