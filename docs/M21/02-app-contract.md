# 02 - App Contract

## App Id

The app id is the canonical business-app slug:

- lowercase only
- starts with a letter
- contains letters, digits, and dashes
- used as `/:appId.nsf`
- maps to database `${appId}_app`
- stored as `AppConfig.appId` and `AppInstall.appId`

Reserved ids:

- `setup`
- `catalog`
- `login`
- `platform`
- `expense`

`expense` is reserved for manual creation because it is the packaged sample app.

## Install Record

Created apps are recorded in `platform_app`:

```ts
{
  _id: `appinstall:${appId}`,
  kind: "appinstall",
  appId,
  title,
  database: `${appId}_app`,
  templateId: "blank:app",
  installedAt,
  installedBy
}
```

The install record is the catalog source of truth for business app routes.

## Starter Definitions

A created app database receives:

- `app:config` for the app title/database.
- `acl:rules` granting the creator `manager`.
- `audit:policy` with the default retention horizon.
- A starter `form:<docType>`.
- A starter `view:<docType>`.

The starter form/view use the existing document-type scaffold contract: a required `title` field and
a newest-first list view.

## ACL Posture

Only the creator receives manager access by default. Created business documents use the generic
document reader policy: the current person's resolved principals can read, and the creator can edit.
