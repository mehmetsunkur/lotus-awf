# 01 - Scope

## Objective

Make the directory a first-class system app in the Lotus catalog and add a directory console for
People and Groups.

## In scope

- Add a `systemApps` section to platform state.
- Show `names.nsf` in the catalog/homepage under System apps.
- Route `/setup.nsf` to first-run setup while setup is incomplete.
- Route `/names.nsf` to an authenticated Directory Console after setup is complete.
- Add authenticated read APIs and manager-only mutation APIs for People and Groups.
- Support person create, display-name edit, active/inactive toggle, and password reset.
- Support group create, display-name edit, and direct person membership edits.
- Prevent last-active-admin lockout.
- Delete active sessions when a person is deactivated.
- Show a read-only installed-apps summary in `names.nsf`.

## Out of scope

- Full app ACL editor.
- Nested groups.
- Username/person id rename.
- User self-service profile page.
- External identity providers, password reset emails, password policy configuration, or offline login.
- Turning directory docs into generic metadata-rendered forms.
