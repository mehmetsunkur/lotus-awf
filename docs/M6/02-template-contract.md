# 02 — Template Contract

## Artifact

The M6 template artifact is API JSON:

```ts
{
  kind: "template";
  templateId: string;
  appId: string;
  version: string;
  createdAt: string;
  createdBy: string;
  source: string;
  definitions: DesignDocument[];
}
```

`templateId` is deterministic: `${appId}:${version}`.

## Included documents

M6 exports:

- `app:config`
- `form:*`
- `view:*`
- `workflow:*`
- `acl:rules`

Business documents (`kind: "document"`) are never part of the artifact.

## Revision handling

Export strips `_rev`. Apply loads the current local `_rev` for each target definition and writes with
that revision if it exists. This avoids carrying stale source-environment revisions into the target.

## ACL posture

`acl:rules` is included for demo completeness. In production, ACLs may need environment binding
rather than direct promotion.
