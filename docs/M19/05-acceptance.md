# 05 - Acceptance

- Catalog shows `names.nsf` under System apps after setup completes.
- Any active authenticated user can open `/names.nsf` after setup and see the read-only Directory Console.
- Directory Console lists People, Groups, and installed apps without exposing password hashes or
  session tokens.
- Admin can create a person and log in as that person after setting a password.
- Admin can edit a person's display name and active flag.
- Deactivating a person deletes their sessions and prevents login.
- Admin can reset a person's password.
- Admin can create a group and edit direct person membership.
- API rejects changes that would leave no active admin in `group:admins`.
- Non-admin authenticated users cannot administer `names.nsf`.
- `npm run test:deploy` verifies `names.nsf` system app visibility in the packaged artifact.
