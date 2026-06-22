# 04 - Build Plan

1. Add M18 docs and the directory/session ADR.
2. Extend shared types for Person, Group, Session, and app ACL entries.
3. Update shared access helpers for session-derived principal scopes and ACL levels.
4. Migrate the Expense JSON template and sample data to `person:*` / `group:*` principals.
5. Add server-side password hashing, session cookie helpers, directory lookup, and principal
   resolution.
6. Update setup/reset to seed deterministic directory records and create sessions.
7. Protect app/runtime/design APIs with session and app ACL checks.
8. Add client login/logout flow.
9. Update deploy and e2e tests to log in and verify unauthenticated rejection.
10. Run build, unit, e2e, deploy, and security review where available.
