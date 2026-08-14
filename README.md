# Lotus Notes — an autonomous multi-agent workflow runtime

> A metadata-driven application platform where **the application is data** — forms, views,
> workflows and access policies are documents, not code — and where **software agents find
> their own work, read the governing policy, and act on it**, with humans able to approve or
> intervene at any step.

This is a working research build, not a product. It rebuilds the *application-platform model*
of Lotus Notes/Domino (code-as-data, per-document security, offline replication) on a modern
stack, and then puts an **autonomous agent runtime** on top of it: LLM agents (Claude Code,
Codex) that operate the platform through a locked-down tool surface exactly as a human employee
would — claiming tasks, moving documents through their workflows, and even **editing the
workflows and policies themselves**.

---

## Why this exists

Most "AI agent" demos wire an LLM directly to bespoke functions. That doesn't scale to a real
organisation, because the hard parts aren't the model — they're **routing** (who should do what,
next?), **authority** (what is this actor allowed to see and do?), **coordination** (many actors,
no double-work), **auditability** (what happened, and why?), and **the last mile** (when to stop
and ask a human). Those are workflow-platform problems that Lotus Notes solved for *people* 30
years ago.

The bet here: if you model the organisation properly first — documents with typed envelopes,
state machines, per-document ACLs, a work-queue — then an agent is **just another actor** on that
substrate. It receives the same routing, the same permissions, and the same audit trail as a
human. Autonomy becomes a governance property of the platform, not a prompt.

That is the shape of system needed for autonomous back-office work (reconciliation, approvals,
month-end close): high autonomy in the common case, hard permission boundaries, a full audit
trail, and a clean hand-back to a human on the edge cases.

---

## The core idea in one loop

```
                    ┌──────────────────────────────────────────────┐
                    │  Lotus platform (CouchDB + Express + React)   │
                    │  documents · workflows · views · per-doc ACL  │
                    └──────────────────────────────────────────────┘
                          ▲                                  │
        (5) transition,   │                                  │  (1) "do I have work
        write artifact    │                                  │      anywhere?"
                          │                                  ▼
   ┌──────────────┐   ┌───┴──────────┐   ┌──────────────────────────────┐
   │  Human user  │   │   Operator   │   │        Work-queue            │
   │  (same UI,   │   │   daemon     │◀──│  @me / responsible routing   │
   │   approvals) │   │              │   │  (cross-app aggregate)       │
   └──────────────┘   └───┬──────────┘   └──────────────────────────────┘
                          │ (2) claim (workflow guard = dedupe)
                          ▼
              ┌────────────────────────────┐   (3) read policy: workflow
              │  Sandboxed agent runner    │◀──     definition, guards, ACL,
              │  (Claude Code / Codex)      │       handbook (RAG)
              │  MCP tools only · budget cap│
              │  · timeout · least priv.    │   (4) act: create / update /
              └────────────────────────────┘       transition documents
```

1. **Find work.** A cross-app work-queue answers a single question — *"do I have work
   anywhere?"* — using `@me`/responsible routing, and hands back the routing refs.
2. **Claim it.** Claiming is a *workflow transition* (`requested → running`), so the state
   machine itself is the dedupe guard: a second agent racing for the same task gets a `422` and
   moves on. No distributed lock needed — the business rule is the lock.
3. **Read the policy.** The agent reads the governing workflow (states, transitions, guards),
   the document, its available transitions, and — via a knowledge-base app — the company
   handbook (retrieval over governed org data).
4. **Act.** It creates/updates/transitions business documents through an app-scoped API. It can
   only do what its **persona's ACL** permits; a technician agent cannot perform dispatch-only
   transitions, and this is *enforced by the platform*, not the prompt.
5. **Record.** Every run writes artifacts (the exact prompt handed over, tool transcript,
   outcome) back as documents — a replicable audit trail.

Humans use the **same platform through a React UI**, so any transition can be gated on human
approval; agents and people share one worklist, one ACL model, one audit log.

### Agents that change the rules, not just follow them

A second tier of agents (**designer/admin**) can alter the application itself:

- `apply_workflow_patch` — add states, add/rewire transitions, change routing on a live workflow
- `apply_template` / `export_template` / `diff_template` — promote a versioned app design
- `update_app_access` — change the ACL

These are the self-improving / self-correcting hooks. Proven by tests where an agent, from a
plain-English instruction, **extends an approval workflow with a reimbursement step** or **adds a
"needs-info" rework loop** — editing the policy documents that other agents then execute.

---

## Architecture

**Data model (the "relational envelope").** Every document is a typed envelope — `type`, `owner`,
ACL arrays, `state`, dates, `version` — plus a **schema-free JSON payload**. The engine and
security touch only the typed envelope; payload shape-drift can't break them, and lists
sort/filter on typed columns for index performance.

**Definitions are data.** Forms (`form:*`), views (`view:*`) and workflows (`workflow:*`) are
documents that live alongside business data and drive the runtime — the modern form of Notes'
code-as-data. Editing an app means writing documents, which is why an *agent* can do it.

**Offline-first substrate.** Two CouchDB nodes (a server and a local replica) model Notes-style
replication; the relational-envelope + per-document ACL design is built so that "what you may
read" also defines "what replicates to you."

**Agent runtime.**
- **MCP tool surfaces** (`src/mcp/`) expose the platform to agents as three scoped toolsets:
  `workspace` (operate: read/create/transition documents), `designer` (author: patch
  workflows, apply templates), `admin` (govern: apps, ACLs). An agent is handed *only* the
  surface its job needs.
- **Operator daemon** (`src/operator/operator.ts`) is the standalone client that works the
  `@me` queue under directory identities, with least-privilege prompt derivation (the operator
  holds no read grants on business apps — it can only assemble a prompt from what the persona
  itself can see).
- **Containerised runner** (`src/operator/container-agent-driver.ts`) runs each agent in an
  isolated container with a **per-run USD budget cap**, a **timeout**, and a **tool lockdown**
  that disables Bash/Read/Write/Web/etc. — the agent's *only* capability is the Lotus MCP
  surface. Drivers exist for **Claude Code** and **Codex**.

**Aspirational vs. implemented.** `docs/vision/03-tech-stack.md` lays out the production-grade
target stack (Postgres + JSONB, PowerSync, OpenFGA, CEL, Keycloak, Temporal). This repo
*implements* the model on a lighter substrate — **CouchDB, a custom workflow engine, a JS
expression layer, React + Express** — enough to prove the agent-runtime thesis end to end. The
gap between the two is deliberate and documented.

---

## A guided tour of the code

Start here, in order:

| File | What it shows |
|------|---------------|
| [`scripts/playground.ts`](scripts/playground.ts) | The whole thing running: seed a company, spawn agents, watch them work a day of field-service jobs across four roles. |
| [`src/operator/operator.ts`](src/operator/operator.ts) | The autonomy loop — poll the work-queue, claim (with race dedupe), derive a least-privilege prompt, run the agent, write audit artifacts. |
| [`src/mcp/tools/workspace.ts`](src/mcp/tools/workspace.ts) | The "operate" tools an agent uses to find and move work (`get_document` returns the transitions it may perform *right now*). |
| [`src/mcp/tools/designer.ts`](src/mcp/tools/designer.ts) | The "author" tools — agents editing workflows/policies (`preview_workflow_patch` → `apply_workflow_patch`). |
| [`src/operator/container-agent-driver.ts`](src/operator/container-agent-driver.ts) | Sandboxing: isolated container, budget cap, timeout, tool lockdown to the MCP surface only. |
| [`tests/mcp/agent/agent.spec.ts`](tests/mcp/agent/agent.spec.ts) | Real-agent acceptance: an agent extends a workflow, adds a rework loop, builds a new app — from natural language. |
| [`tests/mcp/agent/personas.spec.ts`](tests/mcp/agent/personas.spec.ts) | Least-privilege proof: a boundary probe leaves the security projection unchanged. |
| [`docs/vision/`](docs/vision/) | The design thesis: why a re-integrated, offline-first platform, and the target production stack. |

---

## Run it

**Prerequisites:** Node 22+, Docker (for CouchDB and the containerised agent runner).

**1 — The platform (humans + API):**
```bash
npm install
docker compose up -d          # CouchDB server + local-replica pair
npm run seed                  # seed sample apps/data
npm run dev                   # API on :3001, web UI on :3000
```

**2 — The autonomous agents (the interesting part):**

The playground spins up an *isolated* stack (Testcontainers CouchDB pair + MCP host), seeds a
field-services company with four roles (dispatch, technician, inventory, billing), then lets
agents work the queue. It needs an agent driver configured — copy `.env.example` to `.env` and
fill in a Claude or Codex endpoint (each driver self-skips if unconfigured):

```bash
# one persona, one shift:
npm run playground -- field-services --run dana --driver claude-code --once

# seed a morning of work and let the scheduler run the whole day:
npm run playground -- field-services --run-day --driver claude-code
```

Watch the agents claim service requests, schedule work orders, reserve parts, and invoice —
each stopping at the boundary of its role and handing off to the next.

**Tests:**
```bash
npm run test:unit             # shared/runtime unit tests
npm run test:e2e              # Playwright (needs the CouchDB pair up)
npm run test:mcp:agent        # opt-in real-agent acceptance (needs a driver in .env)
```

---

## Status & honesty

- This is a **personal research build** (milestones M1–M28 in `docs/`, 20+ ADRs in
  `docs/decisions/`) — it exists to prove the "agent as a first-class actor on a governed
  workflow substrate" idea, not as production software.
- The substrate is CouchDB + a custom engine; the production target stack is documented but not
  implemented (see *Aspirational vs. implemented* above).
- Built inside an explicit **AI coding-agent workflow** — see `AGENTS.md` / `CLAUDE.md`,
  invariant/doc-sync hooks in `.claude/`, and beads issue tracking in `.beads/`. The project is
  both *about* agents and *built by* agents.

## Repository layout

```
src/shared/      pure, portable core (types, validation, expression engine) — client + server
src/server/      Express + CouchDB: app-scoped document/definition/ACL APIs
src/client/      React UI (the human surface over the same definitions)
src/mcp/         MCP tool surfaces: workspace / designer / admin + HTTP host
src/operator/    autonomous operator daemon + agent drivers (Claude Code, Codex)
scripts/         playground, seeding, replication/conflict spikes
tests/           unit + Playwright e2e + real-agent MCP acceptance
docs/            vision, architecture, ADRs, milestone specs, invariants
deploy/          docker-compose + k8s manifests
```
