# 03 - Runtime Flow

## Designer

The Designer continues to list forms, views, and existing workflows. For a form whose document type has
no workflow, the definition editor shows an approval scaffold panel:

1. choose an approver person or group;
2. create the approval workflow;
3. reload definitions and navigate to the generated `workflow:<docType>`.

Existing workflows remain editable through the structured workflow controls and JSON editor.

## Runtime

Generated workflows use the existing M3 runtime:

- documents without `state` are treated as `draft`;
- the client renders available transitions from `availableTransitions`;
- transition writes call the app-scoped transition API;
- the server applies the transition with `applyTransition`;
- history is appended to the business document.

## Access posture

The scaffold does not change `acl:rules` and does not update existing document `readers` or `authors`.
The selected approver principal only gates `approve` and `reject` transitions through the existing
workflow `requiredRole` check.
