# 05 — Acceptance

## Demo scenario

1. Reset/seed the app.
2. Export the current app template.
3. Confirm the artifact contains definitions and no business documents.
4. Mutate a local definition.
5. Diff the original template and see the changed definition.
6. Apply the template.
7. Confirm the runtime definition is restored.
8. Confirm business documents remain untouched.

## Exit criteria

M6 is complete when the project can prove:

- definitions export as one versioned artifact;
- business documents are excluded;
- diff reports added/removed/changed/unchanged definitions;
- apply updates local definitions without using stale `_rev`;
- apply is non-destructive for definitions missing from the template;
- apply does not touch business documents.
