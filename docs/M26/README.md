# M26 — Agent personas over the MCP workspace surface

The follow-up tier deferred from M25: AI coding-agent CLIs act as **business-user personas**
of Agentic Airlines PLC over `/mcp/workspace` — an employee's agent files a leave request
from a natural-language task, a manager's agent works their `view:my-approvals` inbox, and
an adversarially-prompted agent fails to cross ACL/guard boundaries. Where the existing
real-agent suite (M24 arc, `tests/mcp/agent/agent.spec.ts`) proves an agent can **build and
maintain** apps through the admin/designer surfaces, M26 proves an agent can **operate** one
as an end user — and that the substrate (ACL readers, ADR-0019 approver guards, ADR-0020
`@me` inboxes, per-session MCP identity) holds when the caller is an autonomous agent rather
than a scripted test or a browser.

No server/runtime changes are in scope: this is a test tier over existing substrate, running
under the same opt-in / nightly config (`playwright.mcp.agent.config.ts`) — never on the PR
gate, self-skipping without agent credentials.

- `01-scope.md` — in/out of scope and taxonomy.
- `02-agent-contract.md` — scenarios, outcome oracles, persona sessions, cost controls.
- `03-acceptance.md` — acceptance criteria.
