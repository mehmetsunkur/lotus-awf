import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Database,
  FilePenLine,
  GitCompare,
  RefreshCcw,
  RotateCcw,
  Save,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import type {
  BusinessDocument,
  ConflictDetails,
  FormDefinition,
  FormField,
  ReplicationStatus,
  ViewDefinition
} from "../shared/types";
import "./styles.css";

type Definitions = {
  appConfig: unknown;
  form: FormDefinition;
  view: ViewDefinition;
};

type Draft = Record<string, string | number>;

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ reason: response.statusText }));
    throw new Error(body.reason ?? response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const getPath = (source: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);

const displayValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
};

const fieldDefault = (field: FormField) => (field.type === "number" ? 0 : "");

const payloadToDraft = (form: FormDefinition, doc?: BusinessDocument): Draft =>
  Object.fromEntries(
    form.fields.map((field) => [field.name, (doc?.payload[field.name] as string | number | undefined) ?? fieldDefault(field)])
  );

const draftToPayload = (form: FormDefinition, draft: Draft) =>
  Object.fromEntries(
    form.fields.map((field) => [
      field.name,
      field.type === "number" ? Number(draft[field.name] || 0) : String(draft[field.name] ?? "")
    ])
  );

function StatusStrip({
  status,
  busy,
  onSetup,
  onReset,
  onReplicate,
  onConflictDemo,
  onDesignDemo,
  onRefresh
}: {
  status?: ReplicationStatus;
  busy: boolean;
  onSetup: () => void;
  onReset: () => void;
  onReplicate: () => void;
  onConflictDemo: () => void;
  onDesignDemo: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <p className="kicker">M1 Replica Runtime</p>
        <h1>Expense Replica</h1>
      </div>
      <div className="statusCluster">
        <span className={status?.localReachable ? "pill ok" : "pill bad"}>
          <Database size={16} /> Local {status?.localReachable ? "online" : "offline"}
        </span>
        <span className={status?.serverReachable ? "pill ok" : "pill bad"}>
          {status?.serverReachable ? <Wifi size={16} /> : <WifiOff size={16} />} Server{" "}
          {status?.serverReachable ? "online" : "offline"}
        </span>
        <button onClick={onRefresh} disabled={busy} title="Refresh local runtime state">
          <RefreshCcw size={16} /> Refresh
        </button>
        <button onClick={onSetup} disabled={busy} title="Create and seed local/server databases">
          <Database size={16} /> Setup
        </button>
        <button onClick={onReplicate} disabled={busy} title="Run bidirectional replication">
          <GitCompare size={16} /> Sync
        </button>
        <button onClick={onConflictDemo} disabled={busy} title="Create a forced CouchDB conflict">
          <AlertTriangle size={16} /> Conflict
        </button>
        <button onClick={onDesignDemo} disabled={busy} title="Change form and view definitions on server">
          <FilePenLine size={16} /> Design Edit
        </button>
        <button onClick={onReset} disabled={busy} title="Reset both databases to sample data">
          <RotateCcw size={16} /> Reset
        </button>
      </div>
    </header>
  );
}

function DocumentForm({
  form,
  selected,
  onSave,
  onDelete,
  onNew
}: {
  form: FormDefinition;
  selected?: BusinessDocument;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: (doc: BusinessDocument) => void;
  onNew: () => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => payloadToDraft(form, selected));

  React.useEffect(() => {
    setDraft(payloadToDraft(form, selected));
  }, [form, selected]);

  return (
    <section className="editorPanel">
      <div className="panelHead">
        <div>
          <p className="kicker">{selected ? selected._id : "New local document"}</p>
          <h2>{form.title}</h2>
        </div>
        <button onClick={onNew}>New</button>
      </div>
      <form
        className="fieldGrid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draftToPayload(form, draft));
        }}
      >
        {form.fields.map((field) => (
          <label key={field.name}>
            <span>{field.label}</span>
            <input
              required={field.required}
              type={field.type}
              value={draft[field.name] ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [field.name]: field.type === "number" ? event.target.valueAsNumber || 0 : event.target.value
                }))
              }
            />
          </label>
        ))}
        <div className="formActions">
          {selected ? (
            <button className="danger" type="button" onClick={() => onDelete(selected)}>
              <Trash2 size={16} /> Delete
            </button>
          ) : null}
          <button className="primary" type="submit">
            <Save size={16} /> Save Local
          </button>
        </div>
      </form>
    </section>
  );
}

function DocumentTable({
  view,
  documents,
  selectedId,
  onSelect
}: {
  view: ViewDefinition;
  documents: BusinessDocument[];
  selectedId?: string;
  onSelect: (doc: BusinessDocument) => void;
}) {
  const sorted = [...documents].sort((left, right) => {
    const sort = view.sort?.[0];
    if (!sort) return 0;
    const a = String(getPath(left, sort.field) ?? "");
    const b = String(getPath(right, sort.field) ?? "");
    return sort.direction === "desc" ? b.localeCompare(a) : a.localeCompare(b);
  });

  return (
    <section className="listPanel">
      <div className="panelHead">
        <div>
          <p className="kicker">view:my-expenses</p>
          <h2>{view.title}</h2>
        </div>
        <strong>{documents.length}</strong>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {view.columns.map((column) => (
                <th key={column.field}>{column.label}</th>
              ))}
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((doc) => (
              <tr
                key={doc._id}
                className={doc._id === selectedId ? "selected" : ""}
                onClick={() => onSelect(doc)}
              >
                {view.columns.map((column) => (
                  <td key={column.field}>{displayValue(getPath(doc, column.field))}</td>
                ))}
                <td>{doc._conflicts?.length ? "Conflict" : "Clean"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConflictPanel({
  conflicts,
  selectedConflict,
  onInspect,
  onResolve
}: {
  conflicts: BusinessDocument[];
  selectedConflict?: ConflictDetails;
  onInspect: (doc: BusinessDocument) => void;
  onResolve: (payload: Record<string, unknown>) => void;
}) {
  return (
    <section className="conflictPanel">
      <div className="panelHead">
        <div>
          <p className="kicker">CouchDB conflicts</p>
          <h2>Resolution Queue</h2>
        </div>
        <strong>{conflicts.length}</strong>
      </div>
      <div className="conflictGrid">
        <div className="conflictList">
          {conflicts.map((doc) => (
            <button key={doc._id} onClick={() => onInspect(doc)}>
              <AlertTriangle size={16} /> {doc.payload.description ? String(doc.payload.description) : doc._id}
            </button>
          ))}
          {!conflicts.length ? <p className="empty">No local conflicts.</p> : null}
        </div>
        {selectedConflict ? (
          <div className="revisionCompare">
            <Revision title="Winning revision" doc={selectedConflict.winning} />
            {selectedConflict.conflicts.map((doc) => (
              <Revision key={doc._rev} title={`Conflicting ${doc._rev}`} doc={doc} />
            ))}
            <button className="primary" onClick={() => onResolve(selectedConflict.winning.payload)}>
              <Save size={16} /> Keep Winning Revision
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Revision({ title, doc }: { title: string; doc: BusinessDocument }) {
  return (
    <article className="revision">
      <h3>{title}</h3>
      <pre>{JSON.stringify({ _rev: doc._rev, updatedAt: doc.updatedAt, payload: doc.payload }, null, 2)}</pre>
    </article>
  );
}

function App() {
  const [status, setStatus] = React.useState<ReplicationStatus>();
  const [definitions, setDefinitions] = React.useState<Definitions>();
  const [documents, setDocuments] = React.useState<BusinessDocument[]>([]);
  const [conflicts, setConflicts] = React.useState<BusinessDocument[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>();
  const [selectedConflict, setSelectedConflict] = React.useState<ConflictDetails>();
  const [message, setMessage] = React.useState("Runtime booting.");
  const [busy, setBusy] = React.useState(false);

  const selected = documents.find((doc) => doc._id === selectedId);

  const refresh = React.useCallback(async () => {
    const [nextStatus, nextDefinitions, nextDocuments, nextConflicts] = await Promise.all([
      api<ReplicationStatus>("/api/status"),
      api<Definitions>("/api/definitions"),
      api<BusinessDocument[]>("/api/documents"),
      api<BusinessDocument[]>("/api/conflicts")
    ]);
    setStatus(nextStatus);
    setDefinitions(nextDefinitions);
    setDocuments(nextDocuments);
    setConflicts(nextConflicts);
    if (!selectedId && nextDocuments[0]) setSelectedId(nextDocuments[0]._id);
  }, [selectedId]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(true);
    setMessage(`${label}...`);
    try {
      await task();
      await refresh();
      setMessage(`${label} complete.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    run("Initial refresh", refresh);
  }, []);

  if (!definitions) {
    return (
      <main className="shell">
        <StatusStrip
          status={status}
          busy={busy}
          onSetup={() => run("Setup", () => api("/api/setup", { method: "POST" }))}
          onReset={() => run("Reset", () => api("/api/reset", { method: "POST" }))}
          onReplicate={() => run("Sync", () => api("/api/replicate", { method: "POST" }))}
          onConflictDemo={() => run("Conflict demo", () => api("/api/demo/conflict", { method: "POST" }))}
          onDesignDemo={() =>
            run("Server design edit", () => api("/api/admin/server-definition-demo", { method: "POST" }))
          }
          onRefresh={() => run("Refresh", refresh)}
        />
        <section className="emptyState">
          <h2>Local replica is not seeded</h2>
          <button className="primary" onClick={() => run("Setup", () => api("/api/setup", { method: "POST" }))}>
            <Database size={16} /> Setup Database
          </button>
          <p>{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
        <StatusStrip
        status={status}
        busy={busy}
        onSetup={() => run("Setup", () => api("/api/setup", { method: "POST" }))}
        onReset={() => run("Reset", () => api("/api/reset", { method: "POST" }))}
          onReplicate={() => run("Sync", () => api("/api/replicate", { method: "POST" }))}
          onConflictDemo={() => run("Conflict demo", () => api("/api/demo/conflict", { method: "POST" }))}
          onDesignDemo={() =>
            run("Server design edit", () => api("/api/admin/server-definition-demo", { method: "POST" }))
          }
          onRefresh={() => run("Refresh", refresh)}
        />
      <p className="message">{message}</p>
      <div className="workspace">
        <DocumentTable
          view={definitions.view}
          documents={documents}
          selectedId={selectedId}
          onSelect={(doc) => setSelectedId(doc._id)}
        />
        <DocumentForm
          form={definitions.form}
          selected={selected}
          onNew={() => setSelectedId(undefined)}
          onDelete={(doc) =>
            run("Delete local document", () => api(`/api/documents/${encodeURIComponent(doc._id)}`, { method: "DELETE" }))
          }
          onSave={(payload) =>
            run("Save local document", () =>
              selected
                ? api(`/api/documents/${encodeURIComponent(selected._id)}`, {
                    method: "PUT",
                    body: JSON.stringify({ payload })
                  })
                : api("/api/documents", {
                    method: "POST",
                    body: JSON.stringify({ payload })
                  })
            )
          }
        />
      </div>
      <ConflictPanel
        conflicts={conflicts}
        selectedConflict={selectedConflict}
        onInspect={(doc) =>
          run("Load conflict", async () => {
            setSelectedConflict(await api<ConflictDetails>(`/api/conflicts/${encodeURIComponent(doc._id)}`));
          })
        }
        onResolve={(payload) =>
          selectedConflict
            ? run("Resolve conflict", () =>
                api(`/api/conflicts/${encodeURIComponent(selectedConflict.document._id)}/resolve`, {
                  method: "POST",
                  body: JSON.stringify({ payload })
                })
              )
            : undefined
        }
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
