# 02 — Definition Validation

## Contract

M4 adds shared definition validators in `src/shared/definition-validation.ts`. They validate the
existing M2/M3 definition shapes; M4 does not introduce a new persisted definition format.

The validators cover:

- required ids, kinds, app ids, doc types, and titles;
- form fields, unique field names, section references, select options, and expression fields;
- view columns, filters, and sort directions;
- workflow states, initial state, transitions, duplicate ids, role gates, and guard expressions.

## Parity

Validation runs in two places:

- the browser before saving a structured or JSON-edited definition;
- `PUT /api/definitions/:id` before writing local CouchDB.

This mirrors M2 payload validation: client feedback is immediate, but the API is the enforcing tier.

## Safety posture

Expression validation uses the existing M2 evaluator to catch blocked tokens and syntax errors. This
does not make expressions safe for untrusted citizen authors; it only prevents malformed definitions
from being saved by M4.
