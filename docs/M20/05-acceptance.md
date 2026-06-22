# 05 - Acceptance

- `/catalog.nsf` renders the standard two-pane app workspace.
- `/setup.nsf` after setup renders the standard two-pane app workspace.
- `/expense.nsf` still renders the standard two-pane metadata runtime workspace.
- `/setup.nsf/views/people`, `/setup.nsf/views/groups`, and `/setup.nsf/views/installed-apps`
  select the matching setup section.
- `/catalog.nsf/views/system-apps`, `/catalog.nsf/views/installed-apps`, and
  `/catalog.nsf/views/sample-templates` select the matching catalog section.
- Existing directory create/update/password/group flows still work.
- Existing catalog install/open flows still work.
- Existing Expense view/document/create/designer deep links still work.
- Deploy artifact serves direct system and business `.nsf` routes through the SPA fallback.
