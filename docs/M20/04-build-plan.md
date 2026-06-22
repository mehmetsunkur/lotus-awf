# 04 - Build Plan

1. Add M20 docs for scope, route contract, runtime flow, acceptance, and implementation notes.
2. Refactor client route parsing/path generation to carry a generic `.nsf` app slug.
3. Extract a reusable standard workspace shell for system app sections.
4. Keep `expense.nsf` on the existing metadata runtime while making route helpers app-aware.
5. Render `setup.nsf` People, Groups, and Installed Apps inside the standard workspace.
6. Render `catalog.nsf` System Apps, Installed Apps, and Sample Templates inside the standard
   workspace.
7. Add e2e coverage for `setup.nsf`, `catalog.nsf`, and `expense.nsf` standard-shell behavior.
8. Update context and prior milestone docs that previously described Expense-only shell behavior.
9. Verify with build, unit, e2e, deploy, Beads sync, commits, and push.
