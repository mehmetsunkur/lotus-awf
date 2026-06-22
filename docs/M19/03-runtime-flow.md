# 03 - Runtime Flow

## Routes

- `/setup.nsf` before setup is complete: first-run setup.
- `/setup.nsf` after setup is complete: Directory Console in the standard NSF workspace.
- `/login.nsf`: login screen for unauthenticated users.
- `/catalog.nsf`: catalog with System apps, installed business apps, and sample templates in the
  standard NSF workspace.

## Catalog

The catalog shows System apps separately from business app installs. `setup.nsf` appears even when no
business apps are installed.

## Directory Console

The Directory Console fetches `GET /api/setup/directory` on open and after mutations. M20 renders it
inside the standard NSF workspace with three routed sections:

- People
- Groups
- Installed apps summary

Unauthorized users cannot administer the directory.
