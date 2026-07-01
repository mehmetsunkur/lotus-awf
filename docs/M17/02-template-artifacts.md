# 02 - Template Artifacts

## Files

Bundled templates are stored as paired design and sample-data artifacts:

```text
templates/expense/template.json
templates/expense/sample-data.json
templates/org/template.json
templates/org/sample-data.json
```

`template.json` is a `TemplateArtifact` with design definitions only.

`sample-data.json` is an optional array of business documents used by the sample installer and test
fixtures.

## Design Template

The design template may include:

- `app:config`
- `form:*`
- `view:*`
- `workflow:*`
- `agent:*`
- `acl:rules`
- `audit:policy`

The design template must not include:

- `kind: "document"` business docs
- `agentrun:*`
- `agent:state`
- `auditevent:*`
- `audit:state`
- CouchDB `_rev` values

## Sample Data

Sample data may include only `kind: "document"` business documents. Records use stable ids and
timestamps so the checked-in JSON is deterministic and readable.

## Handler References

Templates may reference native handlers by manifest name, for example:

- `compute: "expense-total-with-tax"`
- `action: "audit-transition"`
- `handler: "record-activity"`

Handler code remains in the runtime/plugin layer. Template validation must reject references that are
not declared in the handler manifest for the matching kind.

## Install Semantics

ADR-0016 replaced fixed sample installs with generic app creation from bundled templates. Creating an
app with `POST /api/platform/apps { appId, title, fromTemplate }` loads the matching bundled template,
re-stamps its definitions and sample records to the chosen app id, writes them to local and server app
databases, then records `appinstall:<appId>` in `platform_app`.

Template promotion APIs remain design-only: export, diff, and apply do not package sample data.
