# M18 - Directory And Login

M18 turns `setup.nsf` into the first platform directory app. It introduces Notes-style Person and
Group documents, username/password login, cookie-backed sessions, and session-derived access checks
for installed apps.

## Goal

- Store people and groups as documents in `setup_app`.
- Replace the fixed `APP_USER` runtime actor with authenticated sessions.
- Resolve the current actor to effective principals such as `person:alice` and `group:finance`.
- Let app ACLs grant minimal access levels to people and groups.
- Keep document `readers`/`authors` as the row-level visibility/edit contract.
- Preserve deterministic dev/e2e reset flows.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-scope.md](01-scope.md) | Milestone boundary and non-goals |
| [02-directory-session-contract.md](02-directory-session-contract.md) | Person, Group, and Session document contract |
| [03-access-contract.md](03-access-contract.md) | Principal resolution and app ACL levels |
| [04-build-plan.md](04-build-plan.md) | Implementation sequence |
| [05-acceptance.md](05-acceptance.md) | Exit criteria and verification |
| [06-implementation-notes.md](06-implementation-notes.md) | Final notes and verification |

## Core posture

Authentication identifies the current person. Authorization resolves that person's groups and app ACL
level, then filters every app/data operation through the existing local-first runtime.
