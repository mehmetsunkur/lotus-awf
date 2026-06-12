import cors from "cors";
import express from "express";
import { ulid } from "ulid";
import type { BusinessDocument, ConflictDetails, FormDefinition, ViewDefinition } from "../shared/types";
import {
  allDocs,
  bulkDocs,
  couchRequest,
  dbExists,
  deleteDb,
  deleteDoc,
  ensureDb,
  getBusinessDocs,
  getDesignDoc,
  getDoc,
  ping,
  putDoc,
  replicateBidirectional
} from "./couch";
import { config } from "./config";
import { createExpenseDoc, seedDocuments } from "./seed-data";

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
  const winning = await getDoc<BusinessDocument>("local", id, "?conflicts=true");
  if (!winning._conflicts?.length) return null;

  const conflicts = await Promise.all(
    winning._conflicts.map((rev) =>
      getDoc<BusinessDocument>("local", id, `?rev=${encodeURIComponent(rev)}`)
    )
  );

  return { document: winning, winning, conflicts };
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
    response.json(await replicateBidirectional());
  })
);

app.get(
  "/api/definitions",
  asyncRoute(async (_request, response) => {
    const [appConfig, form, view] = await Promise.all([
      getDesignDoc("local", "app:config"),
      getDesignDoc("local", "form:expense"),
      getDesignDoc("local", "view:my-expenses")
    ]);
    response.json({ appConfig, form, view });
  })
);

app.get(
  "/api/documents",
  asyncRoute(async (_request, response) => {
    const docs = await getBusinessDocs("local");
    response.json(docs);
  })
);

app.post(
  "/api/documents",
  asyncRoute(async (request, response) => {
    const doc = createExpenseDoc(request.body.payload ?? {}, config.appUser);
    const result = await putDoc("local", doc);
    response.status(201).json({ ...doc, _rev: result.rev });
  })
);

app.put(
  "/api/documents/:id",
  asyncRoute(async (request, response) => {
    const existing = await getDoc<BusinessDocument>("local", routeParam(request.params.id));
    const updated: BusinessDocument = {
      ...existing,
      updatedAt: timestamp(),
      updatedBy: config.appUser,
      payload: request.body.payload ?? existing.payload
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

app.get(
  "/api/conflicts",
  asyncRoute(async (_request, response) => {
    const result = await allDocs<BusinessDocument>("local", {
      include_docs: true,
      conflicts: true
    });
    const docs = result.rows
      .map((row) => row.doc)
      .filter((doc): doc is BusinessDocument => Boolean(doc?.kind === "document" && doc._conflicts?.length));
    response.json(docs);
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

    const resolved: BusinessDocument = {
      ...details.winning,
      _conflicts: undefined,
      updatedAt: timestamp(),
      updatedBy: config.appUser,
      payload: request.body.payload ?? details.winning.payload
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

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  const reason = error instanceof Error ? error.message : "Unexpected error";
  response.status(status || 500).json({ error: "server_error", reason });
});

app.listen(config.apiPort, () => {
  console.log(`M1 API listening on ${config.apiPort}`);
});
