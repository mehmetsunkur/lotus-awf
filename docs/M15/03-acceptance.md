# 03 — Acceptance

M15 is accepted when:

- Direct `/expense.nsf/views/vendors` selects the Vendors view.
- Switching view tabs updates the URL.
- Selecting a document updates the URL to `/expense.nsf/documents/<encoded-id>`.
- Direct `/expense.nsf/design/forms/expense` selects `form:expense`.
- Direct `/expense.nsf/design/views/all-expenses` selects `view:all-expenses`.
- Direct `/expense.nsf/design/workflows/expense` selects `workflow:expense`.
- Browser back/forward updates in-app selection.
- Deploy artifact serves deep routes through the SPA fallback.

## Verification

```bash
npm run build
npm run test:unit
npm run test:deploy
```
