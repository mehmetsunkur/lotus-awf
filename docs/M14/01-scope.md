# 01 — Scope

## In scope

- Boot-time setup database (`setup_app`, surfaced as `setup.nsf`).
- Platform/control database (`platform_app`) with setup state and installed app records.
- First-run setup form for org/domain/admin.
- Empty app catalog after setup.
- Explicit Expense sample installation.
- Deploy test coverage for first-run platform flow.

## Out of scope

- Real authentication/session management.
- Full app template registry and version rollback.
- Multi-app routing beyond opening the existing Expense runtime.
- AI config agents or change sets.
- Production secrets management.

## Decision

Use `setup_app` and `platform_app` as CouchDB database names in this milestone while presenting the
concept as `setup.nsf` in UX/docs. Keep the existing `expense_app` runtime and `/api/reset` for dev/e2e
compatibility.
