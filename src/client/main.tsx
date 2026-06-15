import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Braces,
  Database,
  FilePenLine,
  GitCompare,
  List,
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
  CouchDocument,
  FormDefinition,
  FormField,
  ReplicationStatus,
  SelectOptionsByField,
  ViewDefinition,
  WorkflowDefinition
} from "../shared/types";
import {
  applyFormDefaults,
  isFieldReadOnly,
  isFieldRequired,
  isFieldVisible,
  normalizePayload,
  validatePayload
} from "../shared/validation";
import { availableTransitions, currentState } from "../shared/workflow";
import "./styles.css";

type Definitions = {
  appConfig: unknown;
  forms: FormDefinition[];
  views: ViewDefinition[];
  workflows: WorkflowDefinition[];
  user: string;
  roles: string[];
  form?: FormDefinition;
  view?: ViewDefinition;
};

type Draft = Record<string, unknown>;

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
    const message = body.errors ? JSON.stringify(body.errors) : body.reason ?? response.statusText;
    throw new Error(message);
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
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
};

function StatusStrip({
  status,
  busy,
  onSetup,
  onReset,
  onReplicate,
  onConflictDemo,
  onDefinitionConflictDemo,
  onDesignDemo,
  onRefresh
}: {
  status?: ReplicationStatus;
  busy: boolean;
  onSetup: () => void;
  onReset: () => void;
  onReplicate: () => void;
  onConflictDemo: () => void;
  onDefinitionConflictDemo: () => void;
  onDesignDemo: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar" data-testid="topbar">
      <div>
        <p className="kicker">M2 Metadata Runtime</p>
        <h1>Expense Replica</h1>
      </div>
      <div className="statusCluster">
        <span
          className={status?.localReachable ? "pill ok" : "pill bad"}
          data-testid="status-local"
          data-online={status?.localReachable ? "true" : "false"}
        >
          <Database size={16} /> Local {status?.localReachable ? "online" : "offline"}
        </span>
        <span
          className={status?.serverReachable ? "pill ok" : "pill bad"}
          data-testid="status-server"
          data-online={status?.serverReachable ? "true" : "false"}
        >
          {status?.serverReachable ? <Wifi size={16} /> : <WifiOff size={16} />} Server{" "}
          {status?.serverReachable ? "online" : "offline"}
        </span>
        <button onClick={onRefresh} disabled={busy} title="Refresh local runtime state" data-testid="status-refresh">
          <RefreshCcw size={16} /> Refresh
        </button>
        <button onClick={onSetup} disabled={busy} title="Create and seed databases" data-testid="status-setup">
          <Database size={16} /> Setup
        </button>
        <button onClick={onReplicate} disabled={busy} title="Run bidirectional replication" data-testid="status-sync">
          <GitCompare size={16} /> Sync
        </button>
        <button onClick={onConflictDemo} disabled={busy} title="Create a business document conflict" data-testid="status-data-conflict">
          <AlertTriangle size={16} /> Data Conflict
        </button>
        <button onClick={onDefinitionConflictDemo} disabled={busy} title="Create a form definition conflict" data-testid="status-def-conflict">
          <AlertTriangle size={16} /> Def Conflict
        </button>
        <button onClick={onDesignDemo} disabled={busy} title="Change form and view definitions on server" data-testid="status-server-design">
          <FilePenLine size={16} /> Server Design
        </button>
        <button onClick={onReset} disabled={busy} title="Reset both databases" data-testid="status-reset">
          <RotateCcw size={16} /> Reset
        </button>
      </div>
    </header>
  );
}

function ViewPicker({
  views,
  selectedViewId,
  onSelect
}: {
  views: ViewDefinition[];
  selectedViewId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="band" data-testid="view-picker">
      <div className="segmented">
        {views.map((view) => (
          <button
            key={view._id}
            className={view._id === selectedViewId ? "active" : ""}
            onClick={() => onSelect(view._id)}
            data-testid={`view-tab-${view._id}`}
            data-active={view._id === selectedViewId ? "true" : "false"}
          >
            <List size={16} /> {view.title}
          </button>
        ))}
      </div>
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
  return (
    <section className="listPanel" data-testid="document-table">
      <div className="panelHead">
        <div>
          <p className="kicker">{view._id}</p>
          <h2>{view.title}</h2>
        </div>
        <strong data-testid="document-count">{documents.length}</strong>
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
            {documents.map((doc) => (
              <tr
                key={doc._id}
                className={doc._id === selectedId ? "selected" : ""}
                onClick={() => onSelect(doc)}
                data-testid="doc-row"
                data-doc-id={doc._id}
              >
                {view.columns.map((column) => (
                  <td key={column.field}>{displayValue(getPath(doc, column.field))}</td>
                ))}
                <td data-testid="doc-row-state">
                  {doc.state ? <span className="statePill" data-state={doc.state}>{doc.state}</span> : null}
                  {doc._conflicts?.length ? <span className="conflictTag"> ⚠ conflict</span> : null}
                  {!doc.state && !doc._conflicts?.length ? "—" : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WorkflowBar({
  doc,
  workflow,
  user,
  roles,
  onTransition
}: {
  doc: BusinessDocument;
  workflow: WorkflowDefinition;
  user: string;
  roles: string[];
  onTransition: (transitionId: string) => void;
}) {
  const state = currentState(doc, workflow);
  const stateDef = workflow.states.find((candidate) => candidate.name === state);
  // Same engine the server uses to authorize the write, so we never offer an
  // action the transition endpoint would reject (A2/A3).
  const actions = availableTransitions(doc, workflow, user, roles);

  return (
    <div className="workflowBar" data-testid="workflow-bar">
      <span className="statePill" data-testid="workflow-state" data-state={state}>
        {stateDef?.label ?? state}
      </span>
      <div className="workflowActions">
        {actions.map((transition) => (
          <button
            key={transition.id}
            type="button"
            data-testid={`workflow-action-${transition.id}`}
            onClick={() => onTransition(transition.id)}
          >
            {transition.label}
          </button>
        ))}
        {!actions.length ? <span className="empty" data-testid="workflow-no-actions">No actions available</span> : null}
      </div>
    </div>
  );
}

function WorkflowHistory({ doc }: { doc: BusinessDocument }) {
  const history = doc.history ?? [];
  if (!history.length) return null;
  return (
    <div className="workflowHistory" data-testid="workflow-history">
      <h3>History</h3>
      <ol>
        {history.map((event, index) => (
          <li key={`${event.at}-${index}`}>
            <strong>{event.from} → {event.to}</strong> · {event.by} · {event.at}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DocumentForm({
  form,
  selected,
  optionsByField,
  workflow,
  user,
  roles,
  onSave,
  onDelete,
  onNew,
  onTransition
}: {
  form: FormDefinition;
  selected?: BusinessDocument;
  optionsByField: SelectOptionsByField;
  workflow?: WorkflowDefinition;
  user: string;
  roles: string[];
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: (doc: BusinessDocument) => void;
  onNew: () => void;
  onTransition: (doc: BusinessDocument, transitionId: string) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => applyFormDefaults(form, selected?.payload ?? {}));
  const normalized = normalizePayload(form, draft);
  const errors = validatePayload(form, normalized, selected, optionsByField);

  React.useEffect(() => {
    setDraft(applyFormDefaults(form, selected?.payload ?? {}));
  }, [form, selected]);

  const fieldsByName = Object.fromEntries(form.fields.map((field) => [field.name, field]));
  const sections = form.sections?.length
    ? form.sections
    : [{ title: form.title, fields: form.fields.map((field) => field.name) }];

  return (
    <section className="editorPanel" data-testid="document-form">
      <div className="panelHead">
        <div>
          <p className="kicker" data-testid="form-record-id">{selected ? selected._id : `New ${form.docType}`}</p>
          <h2>{form.title}</h2>
        </div>
        <button onClick={onNew} data-testid="form-new">New</button>
      </div>
      {selected && workflow ? (
        <WorkflowBar
          doc={selected}
          workflow={workflow}
          user={user}
          roles={roles}
          onTransition={(transitionId) => onTransition(selected, transitionId)}
        />
      ) : null}
      <form
        className="fieldGrid"
        data-testid="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!errors.length) onSave(normalized);
        }}
      >
        {sections.map((section) => (
          <fieldset key={section.title}>
            <legend>{section.title}</legend>
            {section.fields.map((name) => {
              const field = fieldsByName[name];
              if (!field || !isFieldVisible(field, selected, normalized)) return null;
              return (
                <FieldEditor
                  key={field.name}
                  field={field}
                  doc={selected}
                  draft={normalized}
                  optionsByField={optionsByField}
                  onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))}
                />
              );
            })}
          </fieldset>
        ))}
        {errors.length ? (
          <div className="errorBox" data-testid="form-errors">
            {errors.map((error) => (
              <p key={`${error.field}-${error.message}`} data-testid={`form-error-${error.field}`}>{error.message}</p>
            ))}
          </div>
        ) : null}
        <div className="formActions">
          {selected ? (
            <button className="danger" type="button" onClick={() => onDelete(selected)} data-testid="form-delete">
              <Trash2 size={16} /> Delete
            </button>
          ) : null}
          <button className="primary" type="submit" disabled={Boolean(errors.length)} data-testid="form-save">
            <Save size={16} /> Save Local
          </button>
        </div>
      </form>
      {selected && workflow ? <WorkflowHistory doc={selected} /> : null}
    </section>
  );
}

function FieldEditor({
  field,
  doc,
  draft,
  optionsByField,
  onChange
}: {
  field: FormField;
  doc?: BusinessDocument;
  draft: Draft;
  optionsByField: SelectOptionsByField;
  onChange: (value: unknown) => void;
}) {
  const value = draft[field.name];
  const readOnly = isFieldReadOnly(field, doc, draft);
  const required = isFieldRequired(field, doc, draft);
  const options = field.options ?? optionsByField[field.name] ?? [];

  return (
    <label className={field.type === "boolean" ? "checkboxLine" : ""}>
      <span>
        {field.label}
        {required ? " *" : ""}
      </span>
      {field.type === "textarea" ? (
        <textarea data-testid={`field-${field.name}`} value={String(value ?? "")} disabled={readOnly} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === "boolean" ? (
        <input data-testid={`field-${field.name}`} type="checkbox" checked={Boolean(value)} disabled={readOnly} onChange={(event) => onChange(event.target.checked)} />
      ) : field.type === "select" ? (
        <select data-testid={`field-${field.name}`} value={String(value ?? "")} disabled={readOnly} required={required} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          data-testid={`field-${field.name}`}
          required={required}
          disabled={readOnly}
          type={field.type}
          value={field.type === "number" ? Number(value ?? 0) : String(value ?? "")}
          onChange={(event) => onChange(field.type === "number" ? event.target.valueAsNumber || 0 : event.target.value)}
        />
      )}
      {field.helpText ? <small>{field.helpText}</small> : null}
    </label>
  );
}

function DefinitionEditor({
  definitions,
  selectedId,
  onSelect,
  onSave
}: {
  definitions: Array<FormDefinition | ViewDefinition>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onSave: (id: string, doc: FormDefinition | ViewDefinition) => void;
}) {
  const selected = definitions.find((doc) => doc._id === selectedId) ?? definitions[0];
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setText(selected ? JSON.stringify(selected, null, 2) : "");
    setError("");
  }, [selected]);

  return (
    <section className="definitionPanel" data-testid="definition-editor">
      <div className="panelHead">
        <div>
          <p className="kicker">Local definition editor</p>
          <h2>Forms & Views</h2>
        </div>
        <select data-testid="definition-select" value={selected?._id ?? ""} onChange={(event) => onSelect(event.target.value)}>
          {definitions.map((doc) => (
            <option key={doc._id} value={doc._id}>
              {doc._id}
            </option>
          ))}
        </select>
      </div>
      <textarea data-testid="definition-json" className="jsonEditor" value={text} onChange={(event) => setText(event.target.value)} />
      {error ? <p className="inlineError" data-testid="definition-error">{error}</p> : null}
      <div className="formActions definitionActions">
        <button
          className="primary"
          data-testid="definition-save"
          onClick={() => {
            try {
              const parsed = JSON.parse(text) as FormDefinition | ViewDefinition;
              if (!selected) return;
              onSave(selected._id, parsed);
            } catch (parseError) {
              setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
            }
          }}
        >
          <Braces size={16} /> Save Definition Locally
        </button>
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
  conflicts: CouchDocument[];
  selectedConflict?: ConflictDetails;
  onInspect: (doc: CouchDocument) => void;
  onResolve: (doc: CouchDocument) => void;
}) {
  return (
    <section className="conflictPanel" data-testid="conflict-panel">
      <div className="panelHead">
        <div>
          <p className="kicker">CouchDB conflicts</p>
          <h2>Resolution Queue</h2>
        </div>
        <strong data-testid="conflict-count">{conflicts.length}</strong>
      </div>
      <div className="conflictGrid">
        <div className="conflictList">
          {conflicts.map((doc) => (
            <button key={doc._id} onClick={() => onInspect(doc)} data-testid="conflict-item" data-doc-id={doc._id}>
              <AlertTriangle size={16} /> {doc._id}
            </button>
          ))}
          {!conflicts.length ? <p className="empty" data-testid="conflict-empty">No local conflicts.</p> : null}
        </div>
        {selectedConflict ? (
          <div className="revisionCompare" data-testid="conflict-detail">
            <Revision
              title="Winning revision"
              doc={selectedConflict.winning}
              primary
              onResolve={() => onResolve(selectedConflict.winning)}
            />
            {selectedConflict.conflicts.map((doc) => (
              <Revision
                key={doc._rev}
                title={`Conflicting ${doc._rev}`}
                doc={doc}
                onResolve={() => onResolve(doc)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Revision({
  title,
  doc,
  primary,
  onResolve
}: {
  title: string;
  doc: CouchDocument;
  primary?: boolean;
  onResolve: () => void;
}) {
  const state = doc.kind === "document" ? doc.state : undefined;
  return (
    <article className="revision">
      <h3>{title}</h3>
      {state ? (
        <span className="statePill" data-testid="revision-state" data-state={state}>
          {state}
        </span>
      ) : null}
      <pre>{JSON.stringify(doc, null, 2)}</pre>
      <button
        className="primary"
        onClick={onResolve}
        data-testid={primary ? "conflict-resolve" : "conflict-keep"}
        data-rev={doc._rev}
        data-state={state ?? ""}
      >
        <Save size={16} /> {primary ? "Keep Winning Revision" : "Keep This Revision"}
      </button>
    </article>
  );
}

function App() {
  const [status, setStatus] = React.useState<ReplicationStatus>();
  const [definitions, setDefinitions] = React.useState<Definitions>();
  const [documents, setDocuments] = React.useState<BusinessDocument[]>([]);
  const [conflicts, setConflicts] = React.useState<CouchDocument[]>([]);
  const [optionsByField, setOptionsByField] = React.useState<SelectOptionsByField>({});
  const [selectedViewId, setSelectedViewId] = React.useState("view:my-expenses");
  const [selectedDefinitionId, setSelectedDefinitionId] = React.useState("form:expense");
  const [selectedId, setSelectedId] = React.useState<string>();
  const [selectedConflict, setSelectedConflict] = React.useState<ConflictDetails>();
  const [message, setMessage] = React.useState("Runtime booting.");
  const [busy, setBusy] = React.useState(false);

  const selectedView = definitions?.views.find((view) => view._id === selectedViewId) ?? definitions?.views[0];
  const selectedForm = definitions?.forms.find((form) => form.docType === selectedView?.docType) ?? definitions?.form;
  const selectedWorkflow = definitions?.workflows.find((workflow) => workflow.docType === selectedForm?.docType);
  const selected = documents.find((doc) => doc._id === selectedId);
  const editableDefinitions = [...(definitions?.forms ?? []), ...(definitions?.views ?? [])];

  const refresh = React.useCallback(async () => {
    const [nextStatus, nextDefinitions, nextConflicts] = await Promise.all([
      api<ReplicationStatus>("/api/status"),
      api<Definitions>("/api/definitions"),
      api<CouchDocument[]>("/api/conflicts")
    ]);
    const view = nextDefinitions.views.find((item) => item._id === selectedViewId) ?? nextDefinitions.views[0];
    const nextDocuments = view ? await api<BusinessDocument[]>(`/api/views/${encodeURIComponent(view._id)}/documents`) : [];
    const form = nextDefinitions.forms.find((item) => item.docType === view?.docType) ?? nextDefinitions.forms[0];
    const nextOptions = form ? await api<SelectOptionsByField>(`/api/forms/${encodeURIComponent(form.docType)}/options`) : {};

    setStatus(nextStatus);
    setDefinitions(nextDefinitions);
    setDocuments(nextDocuments);
    setConflicts(nextConflicts);
    setOptionsByField(nextOptions);
    if (!nextDefinitions.views.some((viewDef) => viewDef._id === selectedViewId) && view) setSelectedViewId(view._id);
    if (!selectedId && nextDocuments[0]) setSelectedId(nextDocuments[0]._id);
  }, [selectedId, selectedViewId]);

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

  const shellActions = {
    status,
    busy,
    onSetup: () => run("Setup", () => api("/api/setup", { method: "POST" })),
    onReset: () => run("Reset", () => api("/api/reset", { method: "POST" })),
    onReplicate: () => run("Sync", () => api("/api/replicate", { method: "POST" })),
    onConflictDemo: () => run("Data conflict demo", () => api("/api/demo/conflict", { method: "POST" })),
    onDefinitionConflictDemo: () =>
      run("Definition conflict demo", () => api("/api/demo/definition-conflict", { method: "POST" })),
    onDesignDemo: () => run("Server design edit", () => api("/api/admin/server-definition-demo", { method: "POST" })),
    onRefresh: () => run("Refresh", refresh)
  };

  if (!definitions || !selectedView || !selectedForm) {
    return (
      <main className="shell">
        <StatusStrip {...shellActions} />
        <section className="emptyState" data-testid="empty-state">
          <h2>Local replica is not seeded</h2>
          <button className="primary" onClick={shellActions.onSetup} data-testid="empty-setup">
            <Database size={16} /> Setup Database
          </button>
          <p data-testid="message">{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <StatusStrip {...shellActions} />
      <p className="message" data-testid="message">{message}</p>
      <ViewPicker
        views={definitions.views}
        selectedViewId={selectedView._id}
        onSelect={(id) => {
          setSelectedId(undefined);
          setSelectedViewId(id);
        }}
      />
      <div className="workspace">
        <DocumentTable view={selectedView} documents={documents} selectedId={selectedId} onSelect={(doc) => setSelectedId(doc._id)} />
        <DocumentForm
          form={selectedForm}
          selected={selected}
          optionsByField={optionsByField}
          workflow={selectedWorkflow}
          user={definitions.user}
          roles={definitions.roles}
          onNew={() => setSelectedId(undefined)}
          onTransition={(doc, transitionId) =>
            run("Transition", () =>
              api(`/api/documents/${encodeURIComponent(doc._id)}/transition`, {
                method: "POST",
                body: JSON.stringify({ transition: transitionId })
              })
            )
          }
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
                    body: JSON.stringify({ docType: selectedForm.docType, payload })
                  })
            )
          }
        />
      </div>
      <DefinitionEditor
        definitions={editableDefinitions}
        selectedId={selectedDefinitionId}
        onSelect={setSelectedDefinitionId}
        onSave={(id, doc) =>
          run("Save local definition", () =>
            api(`/api/definitions/${encodeURIComponent(id)}`, {
              method: "PUT",
              body: JSON.stringify(doc)
            })
          )
        }
      />
      <ConflictPanel
        conflicts={conflicts}
        selectedConflict={selectedConflict}
        onInspect={(doc) =>
          run("Load conflict", async () => {
            setSelectedConflict(await api<ConflictDetails>(`/api/conflicts/${encodeURIComponent(doc._id)}`));
          })
        }
        onResolve={(doc) =>
          selectedConflict
            ? run("Resolve conflict", () =>
                api(`/api/conflicts/${encodeURIComponent(selectedConflict.document._id)}/resolve`, {
                  method: "POST",
                  // chosenRev elects which revision (and its state/history) wins.
                  body: JSON.stringify(
                    doc.kind === "document"
                      ? { chosenRev: doc._rev, payload: doc.payload }
                      : { chosenRev: doc._rev, document: doc }
                  )
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
