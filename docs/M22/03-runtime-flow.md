# 03 - Runtime Flow

## Designer

Business app Designer gets a left-nav Access item. Selecting it opens an Access panel instead of the
definition JSON editor.

The Access panel:

- fetches `GET /api/apps/:appId/access`
- lists current entries
- lets the manager add a person or group
- lets the manager change levels
- lets the manager remove entries
- saves through `PUT /api/apps/:appId/access`

## Existing Users

After access is saved, another authenticated user can open the app according to the granted level.
Existing document rows remain filtered by their `readers`; a user may open the app and see no rows
until documents are shared or they create their own.

## Template Export

`acl:rules` remains design data and is already included in template export. M22 verifies changed ACL
entries export with the app template.
