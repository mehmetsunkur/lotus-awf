# Project Taxonomy

Use this file as the first routing step in the agent workflow. Classification determines which
context, decisions, tests, and blockers an agent must inspect before implementation. The Risk
Classes map to the path-tagged aspects in `docs/invariants.md`.

## Task Classification

- Subsystem:
- Domain Area:
- Change Type:
- Risk Class:
- Runtime Surface:
- Ownership Boundary:
- Required Context Files:
- Relevant ADRs:
- Required Tests:
- Docs/ADR Update Needed:
- Blockers or Prerequisites:

## Subsystems

| Subsystem | Purpose | Primary Paths | Context File | Test Route |
| --- | --- | --- | --- | --- |
| Shared | Portable contract + logic used by client and server: types, validation, expression runtime | `src/shared/**` | `docs/context/shared.md` | `npm run test:e2e` (indirect) |
| Server | Express API over two CouchDB replicas: definitions, documents, replication, conflicts, indexes | `src/server/**`, `scripts/**` | `docs/context/server.md` | `npm run test:e2e` |
| Client | React metadata-driven runtime UI (forms, views, definition editor, conflict panel) | `src/client/**` | `docs/context/client.md` | `npm run test:e2e` |
| MCP Adapter | Stdio MCP server exposing agent-safe app/design operations over the Express API | `src/mcp/**` | `docs/context/mcp.md` | `npm run build`, `npm run test:unit` |
| Playground | Local company testbed runner for isolated Lotus stacks, MCP HTTP, sidecars, and persona agents | `scripts/playground.ts`, `tests/mcp/agent/support/**`, `tests/support/harness.ts` | `docs/context/playground.md` | `npx tsc --noEmit`, `npm run playground -- field-services --once` |

## Domain Areas

| Domain Area | Meaning | Key Concepts | Context File |
| --- | --- | --- | --- |
| Definitions-as-data | `form:*`/`view:*` documents drive the runtime | Form/View definition shape, back-compat | `docs/context/shared.md`, `docs/context/server.md` |
| Validation & expressions | Shared rules + portable evaluator | parity (client+API), eval safety, determinism | `docs/context/shared.md` |
| Replication & conflict | Bidirectional CouchDB sync + resolution | `_rev`/`_conflicts`, push/pull | `docs/context/server.md` |
| Access control | Filtered replication by `readers`/`authors` | ACL leak surface | `docs/context/server.md` |
| Identity & sessions | Directory people/groups, login, session cookies, app ACL levels | names.nsf directory (`names_app`), `person:*`, `group:*`, `session:*` | `docs/context/server.md`, `docs/context/client.md`, `docs/context/shared.md` |
| Offline-first | Local-replica editing with no server round-trip | local vs server CouchDB | `docs/context/server.md`, `docs/context/client.md` |
| Query & indexing | Mango selectors + indexes for views | `use_index`, index triplication | `docs/context/server.md` |
| Deployment & packaging | Built platform artifact and deploy topology | Docker image, deploy compose, readiness, artifact gate | `docs/context/server.md` |
| App lifecycle | First-run setup, app catalog, sample/template install | setup.nsf, platform state, installed apps | `docs/context/server.md`, `docs/context/client.md` |

## Change Types

| Change Type | Examples | Required Checks |
| --- | --- | --- |
| Feature | New behavior or workflow | Context, tests, docs impact |
| Bug fix | Correct incorrect behavior | Reproduction or regression test |
| Refactor | Internal structure change | Existing behavior tests and pattern review |
| Migration | Definition shape, data, or runtime migration | Back-compat for replicated docs; forward/rollback plan |
| Architecture change | Boundary, contract, runtime, or platform decision | ADR review and approval path |
| Operational fix | Docker/seed/replication scripts, recovery | Script dry-run or fixture test |

## Risk Classes

Mapped to the path-tagged aspects in `docs/invariants.md`.

| Risk Class | Aspect(s) | Required Checks |
| --- | --- | --- |
| Contract / back-compat | Definitions-as-data | Replicated-doc back-compat; migration/default |
| Validation parity | Validation parity | Rule enforced on BOTH client and API via `src/shared` |
| Expression safety | Expression runtime | No eval escape; deterministic; portable; fails closed |
| Handler safety | Handler / plugin runtime | Manifest-declared + kind-matched references; pure handlers portable & fail closed; effects server-only, best-effort, never block the transition |
| Agent safety | Agent runtime | Server-authoritative tick; durable at-least-once runs with dedupe; checkpoint advances after writes; failing handler never crashes the tick; runtime docs never templated |
| Data integrity | Replication & conflict | `_rev`/`_conflicts` correctness; no silent loss on resolve |
| Security | ACL / readers | No cross-user/role leak; `readers` honoured |
| Authentication | Identity & sessions | Sessions are HTTP-only, token hashes only, protected routes require session + app ACL |
| Agent interface safety | MCP agent interface | MCP tools call Express APIs, never CouchDB directly; no business-doc or readers/authors mutation |
| Availability | Offline editing | Works against local replica with no server round-trip |
| Performance | Index & query | New sort/filter has an index; three index sites in sync |

## Runtime Surfaces

| Surface | Examples | Required Checks |
| --- | --- | --- |
| Web UI | React runtime (`src/client`) | e2e check (`npm run test:e2e`) |
| Internal API | Express endpoints (`src/server`) | API behavior via e2e; caller-impact |
| MCP Stdio | Local MCP process (`src/mcp`) | Build + unit tests; tool contract docs |
| CLI/Script | `scripts/*.ts` (seed, reset, replicate, force-conflict, acl-spike) | Dry run or fixture-based check |
| Playground CLI | `scripts/playground.ts` (company bootstraps, sidecars, persona shifts) | `npx tsc --noEmit`; `npm run playground -- field-services --once`; sidecar smoke when sidecar code changes |
| Deploy Artifact | Docker image + `deploy/compose.yml` | `npm run test:deploy` |

## Maintenance Rules

Update this file when the project gains a new recurring subsystem, domain area, runtime surface,
risk class, ownership boundary, or test route that should shape agent preflight. When a new aspect
is added, add it to `docs/invariants.md` (with `Paths:`) and reflect it in Risk Classes here.
