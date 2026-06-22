# 05 - Acceptance

M18 is accepted when:

- Setup creates an admin `person:*`, `group:admins`, and an authenticated session.
- Alice and Bob deterministic test people exist after `/api/reset`.
- Users can log in and log out with username/password.
- Passwords are stored with salted `scrypt`, not plaintext or SHA-256.
- Protected API routes reject unauthenticated requests.
- Runtime APIs use session-derived principals instead of `APP_USER`.
- Expense sample principals are `person:alice`, `person:bob`, and `group:finance`.
- Finance workflow approval is granted through `group:finance`.
- App ACL levels gate create/design/manager operations.
- The client shows login when setup is complete but no session exists.
- `npm run build` passes.
- `npm run test:unit` passes.
- `npm run test:e2e` passes.
- `npm run test:deploy` passes.

## Verification

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:deploy
```
