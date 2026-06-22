# 01 - Scope

## In Scope

- Add `person:*` and `group:*` documents to `setup_app`.
- Add `session:*` documents to `platform_app`.
- Hash passwords with Node `crypto.scrypt` and per-person salts.
- Add username/password login and HTTP-only cookie sessions.
- Make setup create the first admin person and auto-login that admin.
- Resolve current session to person, direct groups, effective principals, and app ACL level.
- Migrate the Expense sample to `person:*` and `group:*` principals.
- Enforce authentication on runtime/design/platform mutation APIs.
- Preserve `/api/reset` for dev/e2e and seed deterministic Alice/Bob directory records.

## Out Of Scope

- OIDC/SAML or external identity providers.
- Password reset, email verification, and account recovery.
- Offline login and local credential cache.
- Nested groups.
- Full Domino ACL semantics such as Depositor, No Access, delete flags, or private views.
- Securing direct CouchDB admin ports in local compose.
- Multi-tenant identity.

## Decision

M18 uses setup-local directory documents and platform sessions. Direct CouchDB access remains a local
development spike surface; Express API routes are the authenticated boundary for this milestone.
