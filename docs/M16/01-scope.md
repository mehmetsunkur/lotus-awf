# 01 - Scope

## In Scope

- Add a two-pane runtime shell for installed Expense apps.
- List runtime views from `view:*` definitions in the left pane.
- List create actions from `form:*` definitions in the left pane.
- Add an `Open in Designer` action that opens the Designer workspace in a new browser tab.
- Add a two-pane Designer shell for forms, views, and workflows.
- Move the existing structured definition editor into Designer.
- Direct document routes open documents independently of the active/default view.

## Out Of Scope

- Role-gating the Designer action.
- A new multi-app route registry.
- A separate visual designer implementation beyond the existing form/view/workflow editor.
- Changing form, view, workflow, or document storage contracts.
- Compatibility support for old `/expense.nsf/design/...` routes.
