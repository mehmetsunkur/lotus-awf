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
  Search,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import type {
  AuditEvent,
  BusinessDocument,
  ConflictDetails,
  CouchDocument,
  FieldType,
  FormDefinition,
  FormField,
  PlatformState,
  ReplicationStatus,
  SelectOptionsByField,
  ViewDefinition,
  ViewFilter,
  ViewSort,
  WorkflowDefinition,
  WorkflowState,
  WorkflowTransition
} from "../shared/types";
import { validateDesignDefinition } from "../shared/definition-validation";
import {
  addFieldToSection,
  addSection,
  ensureSections,
  moveFieldToSection,
  moveFieldWithinSection,
  moveSection,
  removeField as removeLayoutField,
  removeSection,
  renameField as renameLayoutField,
  renameSection
} from "../shared/form-layout";
import {
  applyComputedFields,
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
type EditableDefinition = FormDefinition | ViewDefinition | WorkflowDefinition;
type AppRoute = "setup" | "catalog" | "expense";
type ExpenseRoute =
  | { kind: "home" }
  | { kind: "view"; viewId: string }
  | { kind: "document"; docId: string }
  | { kind: "design"; definitionId: string };

type RouteState = {
  app: AppRoute;
  expense: ExpenseRoute;
};

const DEFAULT_EXPENSE_VIEW_ID = "view:my-expenses";

const routeForPath = (path: string): AppRoute => {
  if (path === "/setup.nsf") return "setup";
  if (path === "/expense.nsf") return "expense";
  if (path.startsWith("/expense.nsf/")) return "expense";
  return "catalog";
};

const pathForRoute = (route: AppRoute) =>
  route === "setup" ? "/setup.nsf" : route === "expense" ? "/expense.nsf" : "/catalog.nsf";

const viewIdFromSlug = (slug: string) => `view:${slug}`;
const viewSlugFromId = (id: string) => id.replace(/^view:/, "");
const formIdFromDocType = (docType: string) => `form:${docType}`;
const workflowIdFromDocType = (docType: string) => `workflow:${docType}`;
const docTypeFromDefinitionId = (id: string) => id.replace(/^(form|workflow):/, "");

const expenseRouteForPath = (path: string): ExpenseRoute => {
  const prefix = "/expense.nsf";
  if (path === prefix || !path.startsWith(`${prefix}/`)) return { kind: "home" };
  const parts = path.slice(prefix.length + 1).split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "views" && parts[1]) return { kind: "view", viewId: viewIdFromSlug(parts[1]) };
  if (parts[0] === "documents" && parts[1]) return { kind: "document", docId: parts[1] };
  if (parts[0] === "design" && parts[1] === "forms" && parts[2]) return { kind: "design", definitionId: formIdFromDocType(parts[2]) };
  if (parts[0] === "design" && parts[1] === "views" && parts[2]) return { kind: "design", definitionId: viewIdFromSlug(parts[2]) };
  if (parts[0] === "design" && parts[1] === "workflows" && parts[2]) return { kind: "design", definitionId: workflowIdFromDocType(parts[2]) };
  return { kind: "home" };
};

const routeStateForPath = (path: string): RouteState => ({
  app: routeForPath(path),
  expense: expenseRouteForPath(path)
});

const pathForExpenseRoute = (route: ExpenseRoute) => {
  if (route.kind === "view") return `/expense.nsf/views/${encodeURIComponent(viewSlugFromId(route.viewId))}`;
  if (route.kind === "document") return `/expense.nsf/documents/${encodeURIComponent(route.docId)}`;
  if (route.kind === "design") {
    if (route.definitionId.startsWith("form:")) return `/expense.nsf/design/forms/${encodeURIComponent(docTypeFromDefinitionId(route.definitionId))}`;
    if (route.definitionId.startsWith("view:")) return `/expense.nsf/design/views/${encodeURIComponent(viewSlugFromId(route.definitionId))}`;
    if (route.definitionId.startsWith("workflow:")) return `/expense.nsf/design/workflows/${encodeURIComponent(docTypeFromDefinitionId(route.definitionId))}`;
  }
  return `/expense.nsf/views/${encodeURIComponent(viewSlugFromId(DEFAULT_EXPENSE_VIEW_ID))}`;
};

const pathForRouteState = (route: RouteState) =>
  route.app === "expense" ? pathForExpenseRoute(route.expense) : pathForRoute(route.app);

const expenseRouteKey = (route: ExpenseRoute) => {
  if (route.kind === "view") return `view:${route.viewId}`;
  if (route.kind === "document") return `document:${route.docId}`;
  if (route.kind === "design") return `design:${route.definitionId}`;
  return "home";
};

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

// M10: read-only audit trail for the selected document. Events are recorded
// server-authoritatively (CDC) and replicate read-only; this panel just renders
// what GET /api/audit returns for the document, already ACL-scoped server-side.
function AuditTrail({ events }: { events: AuditEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="auditTrail" data-testid="audit-trail">
      <h3>Audit trail</h3>
      <ol>
        {events.map((event) => (
          <li key={event._id} data-testid="audit-event">
            <strong>{event.action}</strong> · {event.actor} · {event.at}
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
  auditEvents = [],
  preview = false,
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
  auditEvents?: AuditEvent[];
  // M11: render the form read-only as a live studio preview (no save/delete/new,
  // no workflow/audit chrome) using the SAME renderer the runtime uses (WYSIWYG).
  preview?: boolean;
  onSave?: (payload: Record<string, unknown>) => void;
  onDelete?: (doc: BusinessDocument) => void;
  onNew?: () => void;
  onTransition?: (doc: BusinessDocument, transitionId: string) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => applyFormDefaults(form, selected?.payload ?? {}));
  // M7: derive computed fields from the live draft via the SAME shared pure
  // runtime the server uses on save (validation parity), entirely offline. The
  // rendered + saved payload always carries the derived value.
  const normalized = applyComputedFields(form, normalizePayload(form, draft), selected);
  const errors = validatePayload(form, normalized, selected, optionsByField);

  React.useEffect(() => {
    setDraft(applyFormDefaults(form, selected?.payload ?? {}));
  }, [form, selected]);

  const fieldsByName = Object.fromEntries(form.fields.map((field) => [field.name, field]));
  const sections = form.sections?.length
    ? form.sections
    : [{ title: form.title, fields: form.fields.map((field) => field.name) }];

  return (
    <section className="editorPanel" data-testid={preview ? "document-form-preview" : "document-form"}>
      <div className="panelHead">
        <div>
          <p className="kicker" data-testid={preview ? "preview-record-id" : "form-record-id"}>{preview ? "Preview" : selected ? selected._id : `New ${form.docType}`}</p>
          <h2>{form.title}</h2>
        </div>
        {preview ? null : <button onClick={onNew} data-testid="form-new">New</button>}
      </div>
      {!preview && selected && workflow ? (
        <WorkflowBar
          doc={selected}
          workflow={workflow}
          user={user}
          roles={roles}
          onTransition={(transitionId) => onTransition?.(selected, transitionId)}
        />
      ) : null}
      <form
        className="fieldGrid"
        data-testid={preview ? "form-preview" : "form"}
        onSubmit={(event) => {
          event.preventDefault();
          if (!preview && !errors.length) onSave?.(normalized);
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
                  testIdPrefix={preview ? "preview-field" : "field"}
                  onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))}
                />
              );
            })}
          </fieldset>
        ))}
        {!preview && errors.length ? (
          <div className="errorBox" data-testid="form-errors">
            {errors.map((error) => (
              <p key={`${error.field}-${error.message}`} data-testid={`form-error-${error.field}`}>{error.message}</p>
            ))}
          </div>
        ) : null}
        {preview ? null : (
          <div className="formActions">
            {selected ? (
              <button className="danger" type="button" onClick={() => onDelete?.(selected)} data-testid="form-delete">
                <Trash2 size={16} /> Delete
              </button>
            ) : null}
            <button className="primary" type="submit" disabled={Boolean(errors.length)} data-testid="form-save">
              <Save size={16} /> Save Local
            </button>
          </div>
        )}
      </form>
      {!preview && selected && workflow ? <WorkflowHistory doc={selected} /> : null}
      {!preview && selected ? <AuditTrail events={auditEvents} /> : null}
    </section>
  );
}

function FieldEditor({
  field,
  doc,
  draft,
  optionsByField,
  onChange,
  testIdPrefix = "field"
}: {
  field: FormField;
  doc?: BusinessDocument;
  draft: Draft;
  optionsByField: SelectOptionsByField;
  onChange: (value: unknown) => void;
  // M11: the studio preview reuses this renderer; a distinct prefix keeps its
  // field testids from colliding with the live runtime form's `field-*` ids.
  testIdPrefix?: string;
}) {
  const value = draft[field.name];
  // A computed field is intrinsically read-only — its value comes from a handler.
  const readOnly = Boolean(field.compute) || isFieldReadOnly(field, doc, draft);
  const required = isFieldRequired(field, doc, draft);
  const options = field.options ?? optionsByField[field.name] ?? [];
  const testId = `${testIdPrefix}-${field.name}`;

  return (
    <label className={field.type === "boolean" ? "checkboxLine" : ""}>
      <span>
        {field.label}
        {required ? " *" : ""}
      </span>
      {field.type === "textarea" ? (
        <textarea data-testid={testId} value={String(value ?? "")} disabled={readOnly} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === "boolean" ? (
        <input data-testid={testId} type="checkbox" checked={Boolean(value)} disabled={readOnly} onChange={(event) => onChange(event.target.checked)} />
      ) : field.type === "select" ? (
        <select data-testid={testId} value={String(value ?? "")} disabled={readOnly} required={required} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          data-testid={testId}
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

const FIELD_TYPES: FieldType[] = ["text", "textarea", "number", "date", "boolean", "select"];
const FILTER_OPS: ViewFilter["op"][] = ["eq", "ne", "gt", "gte", "lt", "lte", "in"];

const uniqueName = (base: string, used: string[]) => {
  let index = used.length + 1;
  let next = `${base}${index}`;
  while (used.includes(next)) {
    index += 1;
    next = `${base}${index}`;
  }
  return next;
};

function DefinitionEditor({
  definitions,
  selectedId,
  onSelect,
  onSave,
  onCreateType,
  optionsByField,
  user,
  roles
}: {
  definitions: EditableDefinition[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onSave: (id: string, doc: EditableDefinition) => void;
  onCreateType: (docType: string, title: string) => void;
  optionsByField: SelectOptionsByField;
  user: string;
  roles: string[];
}) {
  const [newType, setNewType] = React.useState("");
  const [newTitle, setNewTitle] = React.useState("");
  const selected = definitions.find((doc) => doc._id === selectedId) ?? definitions[0];
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState("");
  const parsed = React.useMemo<EditableDefinition | undefined>(() => {
    try {
      return text ? (JSON.parse(text) as EditableDefinition) : undefined;
    } catch {
      return undefined;
    }
  }, [text]);

  React.useEffect(() => {
    setText(selected ? JSON.stringify(selected, null, 2) : "");
    setError("");
  }, [selected]);

  const updateDefinition = (next: EditableDefinition) => {
    setText(JSON.stringify(next, null, 2));
    setError("");
  };

  const save = () => {
    try {
      const next = JSON.parse(text) as EditableDefinition;
      if (!selected) return;
      const errors = validateDesignDefinition(next as CouchDocument);
      if (errors.length) {
        setError(errors.map((item) => `${item.field}: ${item.message}`).join("; "));
        return;
      }
      onSave(selected._id, next);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
    }
  };

  return (
    <section className="definitionPanel" data-testid="definition-editor">
      <div className="panelHead">
        <div>
          <p className="kicker">Local authoring studio</p>
          <h2>Definitions</h2>
        </div>
        <select data-testid="definition-select" value={selected?._id ?? ""} onChange={(event) => onSelect(event.target.value)}>
          {definitions.map((doc) => (
            <option key={doc._id} value={doc._id}>
              {doc._id}
            </option>
          ))}
        </select>
      </div>
      <form
        className="newTypeForm"
        data-testid="new-type-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newType.trim()) return;
          onCreateType(newType.trim(), newTitle);
          setNewType("");
          setNewTitle("");
        }}
      >
        <span className="kicker">New document type</span>
        <input
          aria-label="New document type"
          data-testid="new-type-doctype"
          placeholder="e.g. invoice"
          value={newType}
          onChange={(event) => setNewType(event.target.value)}
        />
        <input
          aria-label="New document type title"
          data-testid="new-type-title"
          placeholder="Title (optional)"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button type="submit" data-testid="new-type-create" disabled={!newType.trim()}>Create type</button>
      </form>
      {parsed?.kind === "form" ? (
        <div className="studioWithPreview">
          <FormStudio definition={parsed} onChange={updateDefinition} />
          <div className="studioPreview" data-testid="studio-preview">
            <p className="kicker">Live preview</p>
            <DocumentForm form={parsed} optionsByField={optionsByField} user={user} roles={roles} preview />
          </div>
        </div>
      ) : null}
      {parsed?.kind === "view" ? <ViewStudio definition={parsed} onChange={updateDefinition} /> : null}
      {parsed?.kind === "workflow" ? <WorkflowStudio definition={parsed} onChange={updateDefinition} /> : null}
      <details className="jsonEscape" open>
        <summary>JSON</summary>
        <textarea
          data-testid="definition-json"
          className="jsonEditor"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError("");
          }}
        />
      </details>
      {error ? <p className="inlineError" data-testid="definition-error">{error}</p> : null}
      <div className="formActions definitionActions">
        <button className="primary" data-testid="definition-save" onClick={save}>
          <Braces size={16} /> Save Definition Locally
        </button>
      </div>
    </section>
  );
}

// M11: section-grouped layout editor. Every mutation routes through the pure
// `src/shared/form-layout.ts` ops, which keep the layout normalized (sections
// non-empty, every field in exactly one section). Reordering uses accessible
// move buttons (the testable contract); native HTML5 drag is a progressive
// enhancement over the same ops. Field-input testids stay global-index based so
// the M4 authoring spec keeps working; section/move controls are name-based.
function FormStudio({ definition, onChange }: { definition: FormDefinition; onChange: (next: EditableDefinition) => void }) {
  const form = ensureSections(definition);
  const sections = form.sections ?? [];
  const fieldsByName = Object.fromEntries(form.fields.map((field) => [field.name, field] as const));
  const globalIndexOf = (name: string) => form.fields.findIndex((field) => field.name === name);
  const [dragField, setDragField] = React.useState<string>();

  const setFieldProps = (name: string, patch: Partial<FormField>) =>
    onChange({ ...form, fields: form.fields.map((field) => (field.name === name ? { ...field, ...patch } : field)) });

  const dropOnSection = (sectionIndex: number) => {
    if (!dragField) return;
    onChange(moveFieldToSection(form, dragField, sectionIndex));
    setDragField(undefined);
  };

  return (
    <div className="studioPanel" data-testid="studio-form">
      <label>
        <span>Title</span>
        <input data-testid="studio-form-title" value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} />
      </label>
      <div className="studioSections" data-testid="studio-form-sections">
        {sections.map((section, sectionIndex) => (
          <fieldset
            key={`section-${sectionIndex}`}
            className="studioSection"
            data-testid={`studio-section-${sectionIndex}`}
            onDragOver={(event) => {
              if (dragField) event.preventDefault();
            }}
            onDrop={() => dropOnSection(sectionIndex)}
          >
            <div className="studioSectionHead">
              <input
                aria-label="Section title"
                data-testid={`studio-section-title-${sectionIndex}`}
                value={section.title}
                onChange={(event) => onChange(renameSection(form, sectionIndex, event.target.value))}
              />
              <button type="button" aria-label="Move section up" data-testid={`studio-section-up-${sectionIndex}`} disabled={sectionIndex === 0} onClick={() => onChange(moveSection(form, sectionIndex, sectionIndex - 1))}>↑</button>
              <button type="button" aria-label="Move section down" data-testid={`studio-section-down-${sectionIndex}`} disabled={sectionIndex === sections.length - 1} onClick={() => onChange(moveSection(form, sectionIndex, sectionIndex + 1))}>↓</button>
              <button type="button" className="danger" data-testid={`studio-section-remove-${sectionIndex}`} disabled={sections.length <= 1} onClick={() => onChange(removeSection(form, sectionIndex))}>Remove</button>
            </div>
            <div className="studioList">
              {section.fields.map((name, fieldIndex) => {
                const field = fieldsByName[name];
                if (!field) return null;
                const globalIndex = globalIndexOf(name);
                return (
                  <div
                    className="studioRow"
                    key={name}
                    data-testid="studio-form-field"
                    data-field={name}
                    draggable
                    onDragStart={() => setDragField(name)}
                    onDragEnd={() => setDragField(undefined)}
                  >
                    <span className="dragHandle" aria-hidden="true">⠿</span>
                    <input
                      aria-label="Field name"
                      data-testid={`studio-form-field-name-${globalIndex}`}
                      value={field.name}
                      onChange={(event) => onChange(renameLayoutField(form, globalIndex, event.target.value))}
                    />
                    <input
                      aria-label="Field label"
                      data-testid={`studio-form-field-label-${globalIndex}`}
                      value={field.label}
                      onChange={(event) => setFieldProps(name, { label: event.target.value })}
                    />
                    <select
                      aria-label="Field type"
                      data-testid={`studio-form-field-type-${globalIndex}`}
                      value={field.type}
                      onChange={(event) => setFieldProps(name, { type: event.target.value as FieldType })}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <label className="compactCheck">
                      <input
                        data-testid={`studio-form-field-required-${globalIndex}`}
                        type="checkbox"
                        checked={Boolean(field.required)}
                        onChange={(event) => setFieldProps(name, { required: event.target.checked || undefined })}
                      />
                      Required
                    </label>
                    <button type="button" aria-label="Move field up" data-testid={`studio-form-field-up-${name}`} disabled={fieldIndex === 0} onClick={() => onChange(moveFieldWithinSection(form, sectionIndex, fieldIndex, fieldIndex - 1))}>↑</button>
                    <button type="button" aria-label="Move field down" data-testid={`studio-form-field-down-${name}`} disabled={fieldIndex === section.fields.length - 1} onClick={() => onChange(moveFieldWithinSection(form, sectionIndex, fieldIndex, fieldIndex + 1))}>↓</button>
                    <select
                      aria-label="Move field to section"
                      data-testid={`studio-form-field-section-${name}`}
                      value={sectionIndex}
                      onChange={(event) => onChange(moveFieldToSection(form, name, Number(event.target.value)))}
                    >
                      {sections.map((candidate, index) => (
                        <option key={index} value={index}>{candidate.title || `Section ${index + 1}`}</option>
                      ))}
                    </select>
                    <button type="button" className="danger" data-testid={`studio-form-field-remove-${globalIndex}`} onClick={() => onChange(removeLayoutField(form, name))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
              {section.fields.length ? null : (
                <p className="emptySection" data-testid={`studio-section-empty-${sectionIndex}`}>Drag a field here or add one.</p>
              )}
            </div>
            <button
              type="button"
              data-testid={`studio-section-add-field-${sectionIndex}`}
              onClick={() => onChange(addFieldToSection(form, { name: uniqueName("field", form.fields.map((field) => field.name)), type: "text", label: "New field" }, sectionIndex))}
            >
              Add Field
            </button>
          </fieldset>
        ))}
      </div>
      <div className="studioActionsRow">
        <button
          type="button"
          data-testid="studio-form-add-field"
          onClick={() => onChange(addFieldToSection(form, { name: uniqueName("field", form.fields.map((field) => field.name)), type: "text", label: "New field" }, sections.length - 1))}
        >
          Add Field
        </button>
        <button type="button" data-testid="studio-form-add-section" onClick={() => onChange(addSection(form, uniqueName("Section ", sections.map((section) => section.title))))}>
          Add Section
        </button>
      </div>
    </div>
  );
}

function ViewStudio({ definition, onChange }: { definition: ViewDefinition; onChange: (next: EditableDefinition) => void }) {
  const updateColumn = (index: number, patch: Partial<ViewDefinition["columns"][number]>) =>
    onChange({ ...definition, columns: definition.columns.map((column, candidate) => (candidate === index ? { ...column, ...patch } : column)) });
  const filters = definition.filters ?? [];
  const sort = definition.sort?.[0] ?? { field: "updatedAt", direction: "desc" as const };
  const updateFilter = (index: number, patch: Partial<ViewFilter>) =>
    onChange({ ...definition, filters: filters.map((filter, candidate) => (candidate === index ? { ...filter, ...patch } : filter)) });
  const updateSort = (patch: Partial<ViewSort>) => onChange({ ...definition, sort: [{ ...sort, ...patch }] });

  return (
    <div className="studioPanel" data-testid="studio-view">
      <label>
        <span>Title</span>
        <input data-testid="studio-view-title" value={definition.title} onChange={(event) => onChange({ ...definition, title: event.target.value })} />
      </label>
      <div className="studioList">
        {definition.columns.map((column, index) => (
          <div className="studioRow" key={`${column.field}-${index}`} data-testid="studio-view-column">
            <input
              aria-label="Column field"
              data-testid={`studio-view-column-field-${index}`}
              value={column.field}
              onChange={(event) => updateColumn(index, { field: event.target.value })}
            />
            <input
              aria-label="Column label"
              data-testid={`studio-view-column-label-${index}`}
              value={column.label}
              onChange={(event) => updateColumn(index, { label: event.target.value })}
            />
            <button
              type="button"
              className="danger"
              data-testid={`studio-view-column-remove-${index}`}
              onClick={() => onChange({ ...definition, columns: definition.columns.filter((_column, candidate) => candidate !== index) })}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-testid="studio-view-add-column"
        onClick={() => onChange({ ...definition, columns: [...definition.columns, { field: "payload.newField", label: "New Column" }] })}
      >
        Add Column
      </button>
      <div className="studioSubgrid">
        <label>
          <span>Sort field</span>
          <input data-testid="studio-view-sort-field" value={sort.field} onChange={(event) => updateSort({ field: event.target.value })} />
        </label>
        <label>
          <span>Sort direction</span>
          <select data-testid="studio-view-sort-direction" value={sort.direction} onChange={(event) => updateSort({ direction: event.target.value as ViewSort["direction"] })}>
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </label>
      </div>
      <div className="studioList compact">
        {filters.map((filter, index) => (
          <div className="studioRow" key={`${filter.field}-${index}`} data-testid="studio-view-filter">
            <input data-testid={`studio-view-filter-field-${index}`} value={filter.field} onChange={(event) => updateFilter(index, { field: event.target.value })} />
            <select data-testid={`studio-view-filter-op-${index}`} value={filter.op} onChange={(event) => updateFilter(index, { op: event.target.value as ViewFilter["op"] })}>
              {FILTER_OPS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input data-testid={`studio-view-filter-value-${index}`} value={String(filter.value ?? "")} onChange={(event) => updateFilter(index, { value: event.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowStudio({ definition, onChange }: { definition: WorkflowDefinition; onChange: (next: EditableDefinition) => void }) {
  const updateState = (index: number, patch: Partial<WorkflowState>) =>
    onChange({ ...definition, states: definition.states.map((state, candidate) => (candidate === index ? { ...state, ...patch } : state)) });
  const updateTransition = (index: number, patch: Partial<WorkflowTransition>) =>
    onChange({
      ...definition,
      transitions: definition.transitions.map((transition, candidate) => (candidate === index ? { ...transition, ...patch } : transition))
    });
  const stateNames = definition.states.map((state) => state.name);

  return (
    <div className="studioPanel" data-testid="studio-workflow">
      <label>
        <span>Title</span>
        <input data-testid="studio-workflow-title" value={definition.title} onChange={(event) => onChange({ ...definition, title: event.target.value })} />
      </label>
      <label>
        <span>Initial state</span>
        <select data-testid="studio-workflow-initial" value={definition.initialState} onChange={(event) => onChange({ ...definition, initialState: event.target.value })}>
          {stateNames.map((state) => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
      </label>
      <div className="studioList">
        {definition.states.map((state, index) => (
          <div className="studioRow" key={`${state.name}-${index}`} data-testid="studio-workflow-state">
            <input data-testid={`studio-workflow-state-name-${index}`} value={state.name} onChange={(event) => updateState(index, { name: event.target.value })} />
            <input data-testid={`studio-workflow-state-label-${index}`} value={state.label} onChange={(event) => updateState(index, { label: event.target.value })} />
            <label className="compactCheck">
              <input data-testid={`studio-workflow-state-final-${index}`} type="checkbox" checked={Boolean(state.final)} onChange={(event) => updateState(index, { final: event.target.checked || undefined })} />
              Final
            </label>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-testid="studio-workflow-add-state"
        onClick={() => onChange({ ...definition, states: [...definition.states, { name: uniqueName("state", stateNames), label: "New state" }] })}
      >
        Add State
      </button>
      <div className="studioList">
        {definition.transitions.map((transition, index) => (
          <div className="studioRow transitionRow" key={`${transition.id}-${index}`} data-testid="studio-workflow-transition">
            <input data-testid={`studio-workflow-transition-id-${index}`} value={transition.id} onChange={(event) => updateTransition(index, { id: event.target.value })} />
            <input data-testid={`studio-workflow-transition-label-${index}`} value={transition.label} onChange={(event) => updateTransition(index, { label: event.target.value })} />
            <select data-testid={`studio-workflow-transition-from-${index}`} value={transition.from} onChange={(event) => updateTransition(index, { from: event.target.value })}>
              <option value="*">*</option>
              {stateNames.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            <select data-testid={`studio-workflow-transition-to-${index}`} value={transition.to} onChange={(event) => updateTransition(index, { to: event.target.value })}>
              {stateNames.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            <input data-testid={`studio-workflow-transition-guard-${index}`} value={transition.guard ?? ""} onChange={(event) => updateTransition(index, { guard: event.target.value || undefined })} />
            <input data-testid={`studio-workflow-transition-role-${index}`} value={transition.requiredRole ?? ""} onChange={(event) => updateTransition(index, { requiredRole: event.target.value || undefined })} />
          </div>
        ))}
      </div>
      <button
        type="button"
        data-testid="studio-workflow-add-transition"
        onClick={() =>
          onChange({
            ...definition,
            transitions: [
              ...definition.transitions,
              {
                id: uniqueName("transition", definition.transitions.map((transition) => transition.id)),
                label: "New transition",
                from: definition.initialState,
                to: definition.initialState
              }
            ]
          })
        }
      >
        Add Transition
      </button>
    </div>
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

function SetupScreen({
  busy,
  message,
  onSubmit
}: {
  busy: boolean;
  message: string;
  onSubmit: (payload: {
    orgName: string;
    domainName: string;
    adminUser: string;
    adminPassword: string;
    confirmPassword: string;
  }) => void;
}) {
  const [orgName, setOrgName] = React.useState("");
  const [domainName, setDomainName] = React.useState("");
  const [adminUser, setAdminUser] = React.useState("");
  const [adminPassword, setAdminPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  return (
    <main className="shell setupShell" data-testid="setup-shell">
      <section className="setupHero">
        <p className="kicker">setup.nsf</p>
        <h1>Lotus Platform Setup</h1>
      </section>
      <form
        className="band setupForm"
        data-testid="setup-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ orgName, domainName, adminUser, adminPassword, confirmPassword });
        }}
      >
        <label>
          Organization name
          <input value={orgName} data-testid="setup-org" onChange={(event) => setOrgName(event.target.value)} />
        </label>
        <label>
          Domain name
          <input value={domainName} data-testid="setup-domain" onChange={(event) => setDomainName(event.target.value)} />
        </label>
        <label>
          Admin username
          <input value={adminUser} data-testid="setup-admin" onChange={(event) => setAdminUser(event.target.value)} />
        </label>
        <label>
          Admin password
          <input
            type="password"
            value={adminPassword}
            data-testid="setup-password"
            onChange={(event) => setAdminPassword(event.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            data-testid="setup-confirm-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={busy} data-testid="setup-submit">
          <Save size={16} /> Complete Setup
        </button>
        <p className="message" data-testid="message">{message}</p>
      </form>
    </main>
  );
}

function AppCatalog({
  state,
  busy,
  message,
  onInstallExpense,
  onOpenExpense,
  onRefresh
}: {
  state: PlatformState;
  busy: boolean;
  message: string;
  onInstallExpense: () => void;
  onOpenExpense: () => void;
  onRefresh: () => void;
}) {
  const expenseInstalled =
    state.installedApps.some((app) => app.appId === "expense") ||
    state.samples.some((sample) => sample.appId === "expense" && sample.installed);

  return (
    <main className="shell catalogShell" data-testid="catalog-shell">
      <header className="topbar">
        <div>
          <p className="kicker">{state.domainName}</p>
          <h1>{state.orgName || "Lotus Platform"}</h1>
        </div>
        <div className="statusCluster">
          <span className="pill ok" data-testid="catalog-admin">
            <Database size={16} /> {state.adminUser}
          </span>
          <button onClick={onRefresh} disabled={busy} data-testid="catalog-refresh">
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      </header>
      <p className="message" data-testid="message">{message}</p>
      <section className="band" data-testid="installed-apps">
        <div className="sectionHeader">
          <div>
            <p className="kicker">App Catalog</p>
            <h2>Installed apps</h2>
          </div>
        </div>
        {state.installedApps.length ? (
          <div className="definitionList">
            {state.installedApps.map((app) => (
              <article className="definitionCard" key={app._id} data-testid={`installed-app-${app.appId}`}>
                <strong>{app.title}</strong>
                <span>{app.database}</span>
                {app.appId === "expense" && (
                  <button className="primary" onClick={onOpenExpense} disabled={busy} data-testid="open-expense">
                    <List size={16} /> Open
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p data-testid="empty-catalog">No business apps installed.</p>
        )}
      </section>
      <section className="band" data-testid="sample-apps">
        <div className="sectionHeader">
          <div>
            <p className="kicker">Samples</p>
            <h2>Available templates</h2>
          </div>
        </div>
        <article className="definitionCard" data-testid="sample-expense">
          <strong>Expense sample</strong>
          <span>Approval workflow, metadata forms, views, agents, search, and audit.</span>
          {expenseInstalled ? (
            <button className="primary" onClick={onOpenExpense} disabled={busy} data-testid="open-expense-sample">
              <List size={16} /> Open Expense
            </button>
          ) : (
            <button className="primary" onClick={onInstallExpense} disabled={busy} data-testid="install-expense-sample">
              <Database size={16} /> Install
            </button>
          )}
        </article>
      </section>
    </main>
  );
}

function App() {
  const [platformState, setPlatformState] = React.useState<PlatformState>();
  const [route, setRoute] = React.useState<RouteState>(() => routeStateForPath(window.location.pathname));
  const [status, setStatus] = React.useState<ReplicationStatus>();
  const [definitions, setDefinitions] = React.useState<Definitions>();
  const [documents, setDocuments] = React.useState<BusinessDocument[]>([]);
  const [conflicts, setConflicts] = React.useState<CouchDocument[]>([]);
  const [optionsByField, setOptionsByField] = React.useState<SelectOptionsByField>({});
  const [selectedViewId, setSelectedViewId] = React.useState(DEFAULT_EXPENSE_VIEW_ID);
  const [selectedDefinitionId, setSelectedDefinitionId] = React.useState("form:expense");
  const [selectedId, setSelectedId] = React.useState<string>();
  const [selectedConflict, setSelectedConflict] = React.useState<ConflictDetails>();
  const [message, setMessage] = React.useState("Runtime booting.");
  const [busy, setBusy] = React.useState(false);
  // M9 search: `searchInput` drives the controlled box; `searchQueryRef` holds
  // the committed query that `refresh` reads, so commit/clear never refetch with
  // a stale closure. Like view switching, a refetch happens on submit, not keystroke.
  const [searchInput, setSearchInput] = React.useState("");
  const searchQueryRef = React.useRef("");
  // M10: audit trail for the selected document (read-only, server-recorded).
  const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>([]);
  const selectedIdRef = React.useRef<string | undefined>(undefined);
  const lastOpenedExpenseRouteRef = React.useRef("");

  const selectedView = definitions?.views.find((view) => view._id === selectedViewId) ?? definitions?.views[0];
  const selectedForm = definitions?.forms.find((form) => form.docType === selectedView?.docType) ?? definitions?.form;
  const selectedWorkflow = definitions?.workflows.find((workflow) => workflow.docType === selectedForm?.docType);
  const selected = documents.find((doc) => doc._id === selectedId);
  const editableDefinitions = [...(definitions?.forms ?? []), ...(definitions?.views ?? []), ...(definitions?.workflows ?? [])];

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refresh = React.useCallback(async (viewId = selectedViewId) => {
    const [nextStatus, nextDefinitions, nextConflicts] = await Promise.all([
      api<ReplicationStatus>("/api/status"),
      api<Definitions>("/api/definitions"),
      api<CouchDocument[]>("/api/conflicts")
    ]);
    const view = nextDefinitions.views.find((item) => item._id === viewId) ?? nextDefinitions.views[0];
    const query = searchQueryRef.current.trim();
    const documentsUrl = view
      ? `/api/views/${encodeURIComponent(view._id)}/documents${query ? `?q=${encodeURIComponent(query)}` : ""}`
      : "";
    const nextDocuments = view ? await api<BusinessDocument[]>(documentsUrl) : [];
    const form = nextDefinitions.forms.find((item) => item.docType === view?.docType) ?? nextDefinitions.forms[0];
    const nextOptions = form ? await api<SelectOptionsByField>(`/api/forms/${encodeURIComponent(form.docType)}/options`) : {};

    setStatus(nextStatus);
    setDefinitions(nextDefinitions);
    setDocuments(nextDocuments);
    setConflicts(nextConflicts);
    setOptionsByField(nextOptions);
    if (!nextDefinitions.views.some((viewDef) => viewDef._id === viewId) && view) setSelectedViewId(view._id);
    if (!selectedIdRef.current && nextDocuments[0]) setSelectedId(nextDocuments[0]._id);
  }, [selectedViewId]);

  const refreshPlatform = React.useCallback(async () => {
    setPlatformState(await api<PlatformState>("/api/platform/state"));
  }, []);

  const navigate = React.useCallback((nextRoute: RouteState, replace = false) => {
    const nextPath = pathForRouteState(nextRoute);
    if (window.location.pathname !== nextPath) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextPath);
    }
    setRoute(nextRoute);
  }, []);

  const navigateApp = React.useCallback((app: AppRoute, replace = false) => {
    navigate({ app, expense: { kind: "home" } }, replace);
  }, [navigate]);

  const navigateExpense = React.useCallback((expense: ExpenseRoute, replace = false) => {
    navigate({ app: "expense", expense }, replace);
  }, [navigate]);

  const run = async (label: string, task: () => Promise<void>, options: { refreshAfter?: boolean } = {}) => {
    setBusy(true);
    setMessage(`${label}...`);
    try {
      await task();
      if (options.refreshAfter ?? true) await refresh();
      setMessage(`${label} complete.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    run("Initial refresh", refreshPlatform, { refreshAfter: false });
  }, []);

  React.useEffect(() => {
    const onPopState = () => setRoute(routeStateForPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    if (!platformState) return;
    if (!platformState.setupComplete && route.app !== "setup") {
      navigateApp("setup", true);
      return;
    }
    if (platformState.setupComplete && route.app === "setup") {
      navigateApp("catalog", true);
    }
  }, [navigateApp, platformState, route.app]);

  React.useEffect(() => {
    if (!platformState || route.app !== "expense") return;
    const expenseInstalled =
      platformState.installedApps.some((app) => app.appId === "expense") ||
      platformState.samples.some((sample) => sample.appId === "expense" && sample.installed);
    if (!expenseInstalled) {
      navigateApp("catalog", true);
      return;
    }
    if (route.expense.kind === "home") {
      navigateExpense({ kind: "view", viewId: selectedViewId || DEFAULT_EXPENSE_VIEW_ID }, true);
      return;
    }

    const targetViewId = route.expense.kind === "view" ? route.expense.viewId : selectedViewId || DEFAULT_EXPENSE_VIEW_ID;
    const routeKey = expenseRouteKey(route.expense);
    if (lastOpenedExpenseRouteRef.current === routeKey) return;
    lastOpenedExpenseRouteRef.current = routeKey;
    if (route.expense.kind === "view") {
      setSelectedId(undefined);
      selectedIdRef.current = undefined;
      setSelectedViewId(route.expense.viewId);
    }
    run("Open Expense", () => refresh(targetViewId), { refreshAfter: false });
  }, [navigateApp, navigateExpense, platformState, refresh, route.app, route.expense, selectedViewId]);

  React.useEffect(() => {
    if (!definitions || route.app !== "expense") return;
    const expenseRoute = route.expense;
    if (expenseRoute.kind === "view") {
      if (definitions.views.some((view) => view._id === expenseRoute.viewId)) {
        setSelectedId(undefined);
        setSelectedViewId(expenseRoute.viewId);
      } else {
        navigateExpense({ kind: "view", viewId: DEFAULT_EXPENSE_VIEW_ID }, true);
      }
      return;
    }
    if (expenseRoute.kind === "design") {
      if (editableDefinitions.some((definition) => definition._id === expenseRoute.definitionId)) {
        setSelectedDefinitionId(expenseRoute.definitionId);
      } else {
        navigateExpense({ kind: "view", viewId: DEFAULT_EXPENSE_VIEW_ID }, true);
      }
    }
  }, [definitions, editableDefinitions, navigateExpense, route.app, route.expense]);

  React.useEffect(() => {
    const expenseRoute = route.expense;
    if (route.app !== "expense" || expenseRoute.kind !== "document") return;
    if (documents.some((doc) => doc._id === expenseRoute.docId)) {
      setSelectedId(expenseRoute.docId);
    } else if (documents.length) {
      navigateExpense({ kind: "view", viewId: selectedView?._id ?? DEFAULT_EXPENSE_VIEW_ID }, true);
    }
  }, [documents, navigateExpense, route.app, route.expense, selectedView?._id]);

  // Load the selected document's audit trail (read-only; recorded server-side).
  React.useEffect(() => {
    if (!selectedId) {
      setAuditEvents([]);
      return;
    }
    let cancelled = false;
    api<AuditEvent[]>(`/api/audit?docId=${encodeURIComponent(selectedId)}`)
      .then((events) => {
        if (!cancelled) setAuditEvents(events);
      })
      .catch(() => {
        if (!cancelled) setAuditEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, documents]);

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
    onRefresh: () => run("Refresh", refresh, { refreshAfter: false })
  };

  if (!platformState) {
    return (
      <main className="shell">
        <section className="emptyState" data-testid="platform-loading">
          <h2>Loading Lotus platform</h2>
          <p data-testid="message">{message}</p>
        </section>
      </main>
    );
  }

  if (!platformState.setupComplete) {
    return (
      <SetupScreen
        busy={busy}
        message={message}
        onSubmit={(payload) =>
          run(
            "Complete setup",
            async () => {
              setPlatformState(await api<PlatformState>("/api/platform/setup", { method: "POST", body: JSON.stringify(payload) }));
              navigateApp("catalog", true);
            },
            { refreshAfter: false }
          )
        }
      />
    );
  }

  if (route.app !== "expense") {
    return (
      <AppCatalog
        state={platformState}
        busy={busy}
        message={message}
        onRefresh={() => run("Refresh catalog", refreshPlatform, { refreshAfter: false })}
        onInstallExpense={() =>
          run(
            "Install Expense sample",
            async () => {
              setPlatformState(
                await api<PlatformState>("/api/platform/install-sample/expense", {
                  method: "POST"
                })
              );
            },
            { refreshAfter: false }
          )
        }
        onOpenExpense={() => navigateExpense({ kind: "home" })}
      />
    );
  }

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
          navigateExpense({ kind: "view", viewId: id });
        }}
      />
      <form
        className="band"
        data-testid="view-search"
        onSubmit={(event) => {
          event.preventDefault();
          searchQueryRef.current = searchInput;
          run(searchInput.trim() ? "Search" : "Refresh", refresh, { refreshAfter: false });
        }}
      >
        <input
          type="search"
          value={searchInput}
          placeholder="Search this view..."
          aria-label="Search documents"
          data-testid="view-search-input"
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button type="submit" data-testid="view-search-submit" disabled={busy}>
          <Search size={16} /> Search
        </button>
        {searchInput && (
          <button
            type="button"
            data-testid="view-search-clear"
            disabled={busy}
            onClick={() => {
              setSearchInput("");
              searchQueryRef.current = "";
              run("Refresh", refresh, { refreshAfter: false });
            }}
          >
            Clear
          </button>
        )}
      </form>
      <div className="workspace">
        <DocumentTable view={selectedView} documents={documents} selectedId={selectedId} onSelect={(doc) => navigateExpense({ kind: "document", docId: doc._id })} />
        <DocumentForm
          form={selectedForm}
          selected={selected}
          optionsByField={optionsByField}
          workflow={selectedWorkflow}
          user={definitions.user}
          roles={definitions.roles}
          auditEvents={auditEvents}
          onNew={() => {
            setSelectedId(undefined);
            navigateExpense({ kind: "view", viewId: selectedView._id });
          }}
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
        onSelect={(id) => {
          setSelectedDefinitionId(id);
          navigateExpense({ kind: "design", definitionId: id });
        }}
        optionsByField={optionsByField}
        user={definitions.user}
        roles={definitions.roles}
        onSave={(id, doc) =>
          run("Save local definition", () =>
            api(`/api/definitions/${encodeURIComponent(id)}`, {
              method: "PUT",
              body: JSON.stringify(doc)
            })
          )
        }
        onCreateType={(docType, title) =>
          run("Create document type", async () => {
            await api("/api/document-types", { method: "POST", body: JSON.stringify({ docType, title }) });
            // The subsequent refresh reloads definitions; point the studio + view
            // picker at the new type so it is immediately in front of the user.
            setSelectedDefinitionId(`form:${docType}`);
            setSelectedViewId(`view:${docType}`);
            navigateExpense({ kind: "design", definitionId: `form:${docType}` });
          })
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
