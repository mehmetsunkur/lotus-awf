# 03 - Runtime Flow

## Routes

- `/setup.nsf` before setup is complete: first-run setup.
- `/names.nsf` after setup is complete: Directory Console in the standard NSF workspace.
- `/setup.nsf` after setup is complete: redirects to `names.nsf`.
- `/login.nsf`: login screen for unauthenticated users.
- `/catalog.nsf`: catalog with System apps, installed business apps, and sample templates in the
  standard NSF workspace.

## Catalog

The catalog shows System apps separately from business app installs. `names.nsf` appears even when no
business apps are installed.

## Directory Console

The Directory Console fetches `GET /api/names/directory` on open and after mutations. The read route
requires an active authenticated session; mutation routes require manager access. M20 renders it inside
the standard NSF workspace with three routed sections:

- People
- Groups
- Installed apps summary

Non-managers can read the sanitized directory but cannot administer it.
