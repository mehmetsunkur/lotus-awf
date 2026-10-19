# M27 — Digital-twin tier: job-description-driven persona agents

> **Amended by ADR-0026 (2026-10-19):** per-document `readers` (and the M5 revocation purge) were removed — document visibility is the app ACL. Readers-based statements below are historical; see `docs/decisions/0026-app-acl-document-visibility.md`.

The next step past M26: agent personas of Agentic Airlines PLC receive **no scenario
prompts at all**. Everything that steers an agent is company data readable over
`/mcp/workspace`:

- the **org app** holds each employee's job description (who you are, what you own);
- a new **company handbook (KB) app** holds how the company works — which apps exist,
  what the processes are — scoped per department by document `readers`;
- a new **turnaround (operations) app** holds the actual work: a multi-hop workflow
  whose state transitions are owned by different departments, so each completed step
  *is* the next persona's trigger.

The harness seeds a "morning state" (flights parked at various workflow stages, expenses
awaiting finance), then runs each persona's **shift**: one agent run whose prompt is the
persona's own job description plus a single bootstrap pointer to the handbook app.
Oracles are two-sided — *liveness* (the work routed to that persona reached a terminal
state) and *safety* (the security projection of everything else is unchanged).

Where M26 removed the scripted actor, M27 removes the scripted script. What it proves:
the substrate — definitions-as-data, ADR-0018 assignee hand-offs, ADR-0019 guard-gated
stamping, ADR-0020 `@me` inboxes, document-level `readers` — is self-explanatory enough
for an autonomous agent to find and do a day's work from role knowledge alone.

- `01-scope.md` — in/out of scope and taxonomy.
- `02-twin-contract.md` — templates, fixture, shift protocol, shifts and oracles.
- `03-acceptance.md` — acceptance criteria.
