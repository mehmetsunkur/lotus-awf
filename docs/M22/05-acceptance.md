# 05 - Acceptance

M22 is accepted when:

- A business app Designer has an Access section.
- A manager can grant an active person or group an app access level.
- A manager can change or remove an ACL entry.
- Duplicate entries are normalized to one entry per principal.
- Invalid principals and invalid levels are rejected.
- Updates that leave no active manager are rejected.
- Non-manager users cannot read or write app access settings.
- A granted author can open the app and create a document.
- A granted author cannot open the app Designer or edit definitions.
- A granted designer can open Designer and edit definitions.
- Template export includes updated `acl:rules`.
- Existing Expense, setup, catalog, and catalog-created app flows still work.

## Verification

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:deploy
```
