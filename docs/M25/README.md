# M25 — Agentic Airlines PLC scenario testbed

A bundled `leave-request` template plus a reusable multi-persona e2e scenario fixture
("Agentic Airlines PLC") for scripted-persona tests: employees file leave requests and
expenses, managers/finance approve or reject them, and ACL visibility and audit scoping
are asserted across independent authenticated persona sessions.

- `01-scope.md` — in/out of scope and taxonomy.
- `02-scenario-contract.md` — template shape, fixture contract, and ACL design.
- `03-acceptance.md` — acceptance criteria.

For manual testing, `npm run seed:airline` (`scripts/seed-airline.ts`) seeds the same
scenario into a running server — dev (`npm run test:serve`, with `RESET=1`) or a
deploy-compose artifact (pass `API_URL` and the deployment's admin credentials).

The AI-agents-via-MCP tier (Claude-driven personas over `/mcp/workspace`) is a planned
follow-up, not part of M25.
