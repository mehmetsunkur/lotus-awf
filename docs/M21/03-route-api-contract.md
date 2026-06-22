# 03 - Route And API Contract

## Routes

System routes stay special:

- `/setup.nsf`
- `/catalog.nsf`
- `/login.nsf`

Business routes are resolved from `platform_app` install records:

- `/:appId.nsf`
- `/:appId.nsf/views/:viewSlug`
- `/:appId.nsf/documents/:docId`
- `/:appId.nsf/new/:docType`
- `/:appId.nsf/designer`
- `/:appId.nsf/designer/forms/:docType`
- `/:appId.nsf/designer/views/:viewSlug`
- `/:appId.nsf/designer/workflows/:docType`

Unknown business app slugs redirect to `/catalog.nsf`.

## App-Scoped APIs

M21 adds app-scoped metadata runtime APIs:

- `GET /api/apps/:appId/status`
- `POST /api/apps/:appId/replicate`
- `GET /api/apps/:appId/definitions`
- `PUT /api/apps/:appId/definitions/:id`
- `POST /api/apps/:appId/document-types`
- `GET /api/apps/:appId/documents`
- `POST /api/apps/:appId/documents`
- `GET /api/apps/:appId/documents/:id`
- `PUT /api/apps/:appId/documents/:id`
- `DELETE /api/apps/:appId/documents/:id`
- `POST /api/apps/:appId/documents/:id/transition`
- `GET /api/apps/:appId/views/:id/documents`
- `GET /api/apps/:appId/forms/:docType/options`
- `GET /api/apps/:appId/conflicts`
- `GET /api/apps/:appId/conflicts/:id`
- `POST /api/apps/:appId/conflicts/:id/resolve`
- `POST /api/apps/:appId/templates/export`
- `POST /api/apps/:appId/templates/diff`
- `POST /api/apps/:appId/templates/apply`

Unscoped existing routes remain aliases for `expense`.

## Catalog API

`POST /api/platform/apps` creates a new app. Body:

```json
{
  "appId": "field-reports",
  "title": "Field Reports",
  "docType": "report",
  "docTypeTitle": "Report"
}
```

The endpoint requires manager access and returns updated platform state.
