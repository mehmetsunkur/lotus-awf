import cors from "cors";
import express from "express";
import { ulid } from "ulid";
import type {
  AclRules,
  BusinessDocument,
  ConflictDetails,
  CouchDocument,
  FormDefinition,
  SelectOptionsByField,
  ViewDefinition,
  ViewFilter,
  WorkflowDefinition
} from "../shared/types";
import { normalizePayload, validatePayload } from "../shared/validation";
import { applyTransition, currentState } from "../shared/workflow";
import {
  allDocs,
  allRuntimeDocs,
  bulkDocs,
  couchRequest,
  CouchError,
  createIndex,
  dbExists,
  deleteDb,
  deleteDoc,
  ensureDb,
  getBusinessDocs,
  getDesignDoc,
  getDoc,
  findDocs,
  ping,
  putDoc,
  replicateBidirectional
} from "./couch";
import { config } from "./config";
import { createExpenseDoc, createVendorDoc, seedDocuments } from "./seed-data";

const app = express();

app.use(cors());
app.use(express.json());

const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);

const timestamp = () => new Date().toISOString();
const routeParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

async function seedTarget(target: "local" | "server", reset = false) {
  if (reset) {
    await deleteDb(target);
  }
  await ensureDb(target);
  await bulkDocs(target, seedDocuments());
  await ensureIndexes(target);
}

async function ensureIndexes(target: "local" | "server") {
  await createIndex(target, "m2-kind-docType-updatedAt", ["kind", "docType", "updatedAt"]);
  await createIndex(target, "m2-readers", ["readers"]);
  await createIndex(target, "m3-docType-state-updatedAt", ["docType", "state", "updatedAt"]);
}

async function replicationTasks() {
  const [localTasks, serverTasks] = await Promise.allSettled([
    couchRequest("local", "/_active_tasks"),
    couchRequest("server", "/_active_tasks")
  ]);
  return [
    { target: "local", value: localTasks.status === "fulfilled" ? localTasks.value : [] },
    { target: "server", value: serverTasks.status === "fulfilled" ? serverTasks.value : [] }
  ];
}

async function conflictDetails(id: string): Promise<ConflictDetails | null> {
  const winning = await getDoc<CouchDocument & { _conflicts?: string[] }>("local", id, "?conflicts=true");
  if (!winning._conflicts?.length) return null;

  const conflicts = await Promise.all(
    winning._conflicts.map((rev: string) =>
      getDoc<CouchDocument>("local", id, `?rev=${encodeURIComponent(rev)}`)
    )
  );

  return { document: winning, winning, conflicts };
}

function mangoSelector(filters: ViewFilter[] = [], docType?: string) {
  const selector: Record<string, unknown> = { kind: "document" };
  if (docType) selector.docType = docType;

  for (const filter of filters) {
    const op = filter.op === "eq" ? "$eq" : filter.op === "ne" ? "$ne" : `$${filter.op}`;
    selector[filter.field] = { [op]: filter.value };
  }

  return selector;
}

async function formForDocType(docType: string) {
  return getDoc<FormDefinition>("local", `form:${docType}`);
}

async function workflowForDocType(docType: string): Promise<WorkflowDefinition | null> {
  try {
    return await getDoc<WorkflowDefinition>("local", `workflow:${docType}`);
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return null;
    throw error;
  }
}

/** Roles held by a user according to acl:rules; [] if the doc or user is absent. */
async function rolesForUser(user: string): Promise<string[]> {
  try {
    const acl = await getDoc<AclRules>("local", "acl:rules");
    return acl.users.find((entry) => entry.user === user)?.roles ?? [];
  } catch (error) {
    if (error instanceof CouchError && error.status === 404) return [];
    throw error;
  }
}

/**
 * Post-sync reconcile (aspect A4). The CouchDB server cannot reject a replicated
 * revision, so authority over offline transitions is exercised here: we surface
 * documents whose conflicting revisions disagree on `state` (concurrent offline
 * transitions) and flag any winning state the workflow does not declare, so
 * nothing passes silently. The conflicting docs already appear in the conflict
 * queue; this report makes the state divergence explicit.
 */
async function reconcileStates(): Promise<{
  stateConflicts: Array<{ id: string; states: string[] }>;
  invalidStates: Array<{ id: string; state: string }>;
}> {
  const result = await allDocs<CouchDocument & { _conflicts?: string[] }>("local", {
    include_docs: true,
    conflicts: true
  });

  const stateConflicts: Array<{ id: string; states: string[] }> = [];
  const invalidStates: Array<{ id: string; state: string }> = [];
  const workflowCache = new Map<string, WorkflowDefinition | null>();

  for (const row of result.rows) {
    const doc = row.doc;
    if (!doc || doc.kind !== "document") continue;

    if (!workflowCache.has(doc.docType)) {
      workflowCache.set(doc.docType, await workflowForDocType(doc.docType));
    }
    const def = workflowCache.get(doc.docType);
    if (!def) continue;

    if (doc._conflicts?.length) {
      const revs = await Promise.all(
        doc._conflicts.map((rev) =>
          getDoc<BusinessDocument>("local", doc._id, `?rev=${encodeURIComponent(rev)}`)
        )
      );
      const states = Array.from(new Set([currentState(doc, def), ...revs.map((rev) => currentState(rev, def))]));
      if (states.length > 1) stateConflicts.push({ id: doc._id, states });
    }

    const winningState = currentState(doc, def);
    if (!def.states.some((state) => state.name === winningState)) {
      invalidStates.push({ id: doc._id, state: winningState });
    }
  }

  if (stateConflicts.length || invalidStates.length) {
    console.warn("reconcileStates findings", { stateConflicts, invalidStates });
  }
  return { stateConflicts, invalidStates };
}

async function selectOptionsForForm(form: FormDefinition): Promise<SelectOptionsByField> {
  const entries = await Promise.all(
    form.fields
      .filter((field) => field.type === "select" && field.source)
      .map(async (field) => {
        const docs = await getBusinessDocs("local", field.source!.docType);
        return [
          field.name,
          docs.map((doc) => ({
            value: String(field.source!.valueField ? getPath(doc, field.source!.valueField) : doc._id),
            label: String(getPath(doc, field.source!.labelField) ?? doc._id)
          }))
        ] as const;
      })
  );

  return Object.fromEntries(entries);
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    response.json({ ok: true, appDb: config.appDb, appUser: config.appUser });
  })
);

app.get(
  "/api/status",
  asyncRoute(async (_request, response) => {
    const [localReachable, serverReachable, localDbExists, serverDbExists, replications] =
      await Promise.all([
        ping("local"),
        ping("server"),
        dbExists("local"),
        dbExists("server"),
        replicationTasks()
      ]);

    response.json({ localReachable, serverReachable, localDbExists, serverDbExists, replications });
  })
);

app.post(
  "/api/setup",
  asyncRoute(async (_request, response) => {
    await Promise.all([seedTarget("local"), seedTarget("server")]);
    response.json({ ok: true });
  })
);

app.post(
  "/api/reset",
  asyncRoute(async (_request, response) => {
    await Promise.all([seedTarget("local", true), seedTarget("server", true)]);
    response.json({ ok: true });
  })
);

app.post(
  "/api/replicate",
  asyncRoute(async (_request, response) => {
    const replication = await replicateBidirectional();
    const reconcile = await reconcileStates();
    response.json({ ...replication, reconcile });
  })
);

app.get(
  "/api/definitions",
  asyncRoute(async (_request, response) => {
    const [appConfig, forms, views, workflows] = await Promise.all([
      getDesignDoc("local", "app:config"),
      findDocs<FormDefinition>("local", { selector: { kind: "form" }, limit: 100 }),
      findDocs<ViewDefinition>("local", { selector: { kind: "view" }, limit: 100 }),
      findDocs<WorkflowDefinition>("local", { selector: { kind: "workflow" }, limit: 100 })
    ]);
    response.json({
      appConfig,
      forms: forms.docs.sort((left, right) => left.title.localeCompare(right.title)),
      views: views.docs.sort((left, right) => left.title.localeCompare(right.title)),
      workflows: workflows.docs.sort((left, right) => left.title.localeCompare(right.title)),
      user: config.appUser,
      // Roles are surfaced so the client offers only the actions the server would
      // accept; the transition endpoint re-checks them authoritatively (A5).
      roles: await rolesForUser(config.appUser),
      form: forms.docs.find((form) => form._id === "form:expense"),
      view: views.docs.find((view) => view._id === "view:my-expenses")
    });
  })
);

app.get(
  "/api/documents",
  asyncRoute(async (_request, response) => {
    const docType = typeof _request.query.docType === "string" ? _request.query.docType : "expense";
    const docs = await getBusinessDocs("local", docType);
    response.json(docs);
  })
);

app.get(
  "/api/views/:id/documents",
  asyncRoute(async (request, response) => {
    const view = await getDoc<ViewDefinition>("local", routeParam(request.params.id));
    const sort = view.sort?.[0];
    const body: Record<string, unknown> = {
      selector: mangoSelector(view.filters, view.docType),
      limit: 200
    };
    if (sort && sort.field === "updatedAt") {
      body.sort = [{ updatedAt: sort.direction }];
      // State-filtered worklists bind the m3 index (docType+state prefix);
      // everything else uses the general kind+docType index. Hints resolve now
      // that createIndex pins ddoc === name.
      const filtersByState = view.filters?.some((filter) => filter.field === "state");
      body.use_index = filtersByState ? "m3-docType-state-updatedAt" : "m2-kind-docType-updatedAt";
    }
    const result = await findDocs<BusinessDocument>("local", body);
    response.json(result.docs);
  })
);

app.get(
  "/api/forms/:docType/options",
  asyncRoute(async (request, response) => {
    const form = await formForDocType(routeParam(request.params.docType));
    response.json(await selectOptionsForForm(form));
  })
);

app.post(
  "/api/documents",
  asyncRoute(async (request, response) => {
    const docType = request.body.docType ?? "expense";
    const form = await formForDocType(docType);
    const optionsByField = await selectOptionsForForm(form);
    const payload = normalizePayload(form, request.body.payload ?? {});
    const errors = validatePayload(form, payload, undefined, optionsByField);
    if (errors.length) {
      response.status(422).json({ error: "validation_failed", errors });
      return;
    }
    const doc = docType === "vendor" ? createVendorDoc(payload, config.appUser) : createExpenseDoc(payload, config.appUser);
    const result = await putDoc("local", doc);
    response.status(201).json({ ...doc, _rev: result.rev });
  })
);

app.put(
  "/api/documents/:id",
  asyncRoute(async (request, response) => {
    const existing = await getDoc<BusinessDocument>("local", routeParam(request.params.id));
    const form = await formForDocType(existing.docType);
    const payload = normalizePayload(form, request.body.payload ?? existing.payload);
    const errors = validatePayload(form, payload, existing, await selectOptionsForForm(form));
    if (errors.length) {
      response.status(422).json({ error: "validation_failed", errors });
      return;
    }
    const updated: BusinessDocument = {
      ...existing,
      updatedAt: timestamp(),
      updatedBy: config.appUser,
      payload
    };
    const result = await putDoc("local", updated);
    response.json({ ...updated, _rev: result.rev });
  })
);

app.delete(
  "/api/documents/:id",
  asyncRoute(async (request, response) => {
    const existing = await getDoc<BusinessDocument>("local", routeParam(request.params.id));
    await deleteDoc("local", existing._id, existing._rev ?? "");
    response.status(204).end();
  })
);

app.post(
  "/api/documents/:id/transition",
  asyncRoute(async (request, response) => {
    const existing = await getDoc<BusinessDocument>("local", routeParam(request.params.id));
    const def = await workflowForDocType(existing.docType);
    if (!def) {
      response.status(404).json({ error: "not_found", reason: `No workflow for ${existing.docType}` });
      return;
    }
    const roles = await rolesForUser(config.appUser);
    // Same shared engine the client uses to offer the action — authoritative here (A2/A3).
    const result = applyTransition(existing, def, request.body.transition, config.appUser, roles, timestamp());
    if (!result.ok) {
      response.status(422).json({ error: "transition_failed", errors: result.errors });
      return;
    }
    const updated: BusinessDocument = { ...result.document, updatedAt: timestamp(), updatedBy: config.appUser };
    const put = await putDoc("local", updated);
    response.json({ ...updated, _rev: put.rev });
  })
);

app.get(
  "/api/conflicts",
  asyncRoute(async (_request, response) => {
    const result = await allDocs<CouchDocument>("local", {
      include_docs: true,
      conflicts: true
    });
    const docs = result.rows
      .map((row) => row.doc)
      .filter((doc): doc is CouchDocument => Boolean((doc as (CouchDocument & { _conflicts?: string[] }) | undefined)?._conflicts?.length));
    response.json(docs);
  })
);

app.put(
  "/api/definitions/:id",
  asyncRoute(async (request, response) => {
    const id = routeParam(request.params.id);
    if (!id.startsWith("form:") && !id.startsWith("view:")) {
      response.status(400).json({ error: "bad_request", reason: "Only form:* and view:* docs are editable in M2" });
      return;
    }
    const existing = await getDoc<CouchDocument>("local", id);
    const next = { ...request.body, _id: id, _rev: existing._rev };
    const result = await putDoc("local", next);
    response.json({ ...next, _rev: result.rev });
  })
);

app.get(
  "/api/conflicts/:id",
  asyncRoute(async (request, response) => {
    const details = await conflictDetails(routeParam(request.params.id));
    if (!details) {
      response.status(404).json({ error: "not_found", reason: "Document has no local conflicts" });
      return;
    }
    response.json(details);
  })
);

app.post(
  "/api/conflicts/:id/resolve",
  asyncRoute(async (request, response) => {
    const details = await conflictDetails(routeParam(request.params.id));
    if (!details) {
      response.status(404).json({ error: "not_found", reason: "Document has no local conflicts" });
      return;
    }

    // The human may elect which revision wins by passing its _rev. For a
    // concurrent transition this is how the intended terminal state is chosen,
    // not just payload (A4): the elected revision's state/history survive. The
    // chosen content is written onto the surviving (winning) lineage and every
    // conflict leaf is deleted, so exactly one revision remains.
    const chosenRev = request.body.chosenRev as string | undefined;
    const chosen = (chosenRev && details.conflicts.find((rev) => rev._rev === chosenRev)) || details.winning;

    const resolved =
      chosen.kind === "document"
        ? {
            ...chosen,
            _rev: details.winning._rev,
            _conflicts: undefined,
            updatedAt: timestamp(),
            updatedBy: config.appUser,
            payload: request.body.payload ?? chosen.payload
          }
        : {
            ...chosen,
            _rev: details.winning._rev,
            _conflicts: undefined,
            ...(request.body.document ?? {})
          };
    const result = await putDoc("local", resolved);

    await Promise.all(details.conflicts.map((conflict) => deleteDoc("local", conflict._id, conflict._rev ?? "")));

    response.json({ ...resolved, _rev: result.rev });
  })
);

app.post(
  "/api/demo/conflict",
  asyncRoute(async (_request, response) => {
    await ensureDb("local");
    await ensureDb("server");
    const doc = createExpenseDoc({ amount: 77, description: "Conflict seed", spentAt: "2026-06-12" });
    const localPut = await putDoc("local", doc);
    await replicateBidirectional();

    const localBase = await getDoc<BusinessDocument>("local", doc._id);
    const serverBase = await getDoc<BusinessDocument>("server", doc._id);

    await putDoc("local", {
      ...localBase,
      payload: { ...localBase.payload, description: `Local edit ${ulid()}` },
      updatedAt: timestamp()
    });
    await putDoc("server", {
      ...serverBase,
      payload: { ...serverBase.payload, description: `Server edit ${ulid()}` },
      updatedAt: timestamp()
    });

    await replicateBidirectional();
    response.json({ id: doc._id, baseRev: localPut.rev, details: await conflictDetails(doc._id) });
  })
);

app.post(
  "/api/demo/definition-conflict",
  asyncRoute(async (_request, response) => {
    await ensureDb("local");
    await ensureDb("server");
    await replicateBidirectional();

    const localForm = await getDoc<FormDefinition>("local", "form:expense");
    const serverForm = await getDoc<FormDefinition>("server", "form:expense");

    await putDoc("local", {
      ...localForm,
      title: `Expense Local ${Date.now()}`
    });
    await putDoc("server", {
      ...serverForm,
      title: `Expense Server ${Date.now()}`
    });

    await replicateBidirectional();
    response.json({ id: "form:expense", details: await conflictDetails("form:expense") });
  })
);

app.post(
  "/api/demo/state-conflict",
  asyncRoute(async (_request, response) => {
    await ensureDb("local");
    await ensureDb("server");
    const def = await getDoc<WorkflowDefinition>("local", "workflow:expense");
    const roles = ["role:finance"];

    // Submit a fresh expense and replicate it to both replicas.
    const base = createExpenseDoc({ amount: 88, description: `State conflict ${ulid()}`, spentAt: "2026-06-13" });
    const submitted = applyTransition(base, def, "submit", config.appUser, roles, timestamp());
    if (!submitted.ok) throw new Error(submitted.errors[0]?.message ?? "submit failed");
    await putDoc("local", submitted.document);
    await replicateBidirectional();

    // Diverge: approve on local, reject on server — both from `submitted`.
    const localBase = await getDoc<BusinessDocument>("local", base._id);
    const serverBase = await getDoc<BusinessDocument>("server", base._id);
    const approved = applyTransition(localBase, def, "approve", config.appUser, roles, timestamp());
    const rejected = applyTransition(serverBase, def, "reject", config.appUser, roles, timestamp());
    if (!approved.ok || !rejected.ok) throw new Error("divergent transitions failed");
    await putDoc("local", { ...approved.document, updatedAt: timestamp() });
    await putDoc("server", { ...rejected.document, updatedAt: timestamp() });

    await replicateBidirectional();
    response.json({ id: base._id, details: await conflictDetails(base._id) });
  })
);

app.get(
  "/api/admin/server-definitions",
  asyncRoute(async (_request, response) => {
    const [form, view] = await Promise.all([
      getDoc<FormDefinition>("server", "form:expense"),
      getDoc<ViewDefinition>("server", "view:my-expenses")
    ]);
    response.json({ form, view });
  })
);

app.post(
  "/api/admin/server-definition-demo",
  asyncRoute(async (_request, response) => {
    const [form, view] = await Promise.all([
      getDoc<FormDefinition>("server", "form:expense"),
      getDoc<ViewDefinition>("server", "view:my-expenses")
    ]);

    const nextForm: FormDefinition = {
      ...form,
      fields: form.fields.some((field) => field.name === "merchant")
        ? form.fields
        : [...form.fields, { name: "merchant", type: "text", label: "Merchant" }]
    };
    const nextView: ViewDefinition = {
      ...view,
      columns: view.columns.some((column) => column.field === "payload.merchant")
        ? view.columns
        : [
            { field: "payload.merchant", label: "Merchant" },
            ...view.columns
          ]
    };

    const [formResult, viewResult] = await Promise.all([putDoc("server", nextForm), putDoc("server", nextView)]);
    response.json({ formRev: formResult.rev, viewRev: viewResult.rev });
  })
);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  const reason = error instanceof Error ? error.message : "Unexpected error";
  response.status(status || 500).json({ error: "server_error", reason });
});

app.listen(config.apiPort, () => {
  console.log(`M1 API listening on ${config.apiPort}`);
});
