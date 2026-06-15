# 04 — Build Plan

## Step 1 — M4 docs and validation contract

Add M4 docs and shared validators for form, view, and workflow definitions. Wire the API definition
save route to reject invalid definitions with `422`.

## Step 2 — Structured authoring UI

Replace the JSON-only definition editor with structured studio panels while keeping JSON as an escape
hatch.

## Step 3 — Acceptance verification

Add e2e coverage for structured form, view, and workflow edits plus invalid definition rejection.
Run build and the e2e suite.
