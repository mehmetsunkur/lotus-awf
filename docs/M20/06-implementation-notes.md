# 06 - Implementation Notes

- Added generic `.nsf` route helpers in `src/client/main.tsx`; route parsing now carries an app slug
  for `setup`, `catalog`, and `expense`, while `/login.nsf` remains special.
- Added standard section sidebars for system apps and rendered `catalog.nsf` inside
  `runtime-workspace` with System Apps, Installed Apps, and Sample Templates views.
- Rendered post-setup `setup.nsf` inside `runtime-workspace` with People, Groups, and Installed Apps
  views while preserving the manager-only directory APIs.
- Kept Expense document, view, create, designer, audit, conflict, and local-first API paths unchanged.
- No server API changes were required for M20; app-scoped document APIs remain a future multi-app
  substrate step.
- Deploy verification now probes direct `/setup.nsf/views/people` and
  `/catalog.nsf/views/system-apps` SPA fallback routes.

## Verification

```bash
npm run build
npm run test:unit
npm run test:e2e
npm run test:deploy
```
