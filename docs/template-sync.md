# Template Sync

Use this file to track upstream template drift separately from project-specific documentation.

## Drift Types

- Template drift: upstream template files changed after this project copied them.
- Project customization: copied files were adapted to local project knowledge.
- Doc/code drift: local docs may be stale against local code; use `docs/doc-sync.md` for that.

## Update Policy

Do not re-copy a template over an existing project. Template updates must be report-only by default.

Ownership rules:

- `template`: generic template file; may be replaced only if locally unchanged.
- `hybrid`: template structure plus project content; manual merge required.
- `project`: project knowledge; never overwrite automatically.

Use `docs/template-sync.yml` to identify the applied template version, source commit, and file
ownership before reviewing upstream changes.
