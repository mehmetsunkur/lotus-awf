import type { FormDefinition, ValidationError, ViewDefinition } from "./types";
import { fold } from "./search";

/**
 * Document-type scaffolding (M12). Pure: builds the starter definitions for a
 * brand-new document type so a citizen can create an app from scratch. The
 * server validates the output with the existing definition validators and
 * writes it; this module does no I/O, exactly like the other `src/shared`
 * engines.
 *
 * A new type needs BOTH a form (to edit documents) and a view (to list them and
 * reach the form in the runtime), so `scaffoldDocumentType` returns the pair.
 */

/** Design-doc id prefixes a docType must not collide with. */
const RESERVED_DOCTYPES = new Set(["app", "acl", "form", "view", "workflow", "agent", "audit"]);

/** A docType is a lowercase slug: starts with a letter, then letters/digits/dashes. */
const DOCTYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Normalize free text into a candidate docType slug (accent-folded, dash-joined). */
export function slugifyDocType(input: string): string {
  return fold(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Validate a docType slug. Empty result means valid. */
export function validateDocType(docType: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!docType || !docType.trim()) {
    errors.push({ field: "docType", message: "Document type is required" });
    return errors;
  }
  if (!DOCTYPE_PATTERN.test(docType)) {
    errors.push({ field: "docType", message: "Document type must be a lowercase slug (a-z, 0-9, dashes; starting with a letter)" });
  }
  if (RESERVED_DOCTYPES.has(docType)) {
    errors.push({ field: "docType", message: `Document type "${docType}" is reserved` });
  }
  return errors;
}

/**
 * Build the starter form + view for a new document type. The form has one
 * "Details" section with a single required `title` text field; the view lists
 * documents by that title, newest first. Both pass the shared validators.
 */
export function scaffoldDocumentType(
  appId: string,
  docType: string,
  title: string
): { form: FormDefinition; view: ViewDefinition } {
  const label = title.trim() || docType;
  const form: FormDefinition = {
    _id: `form:${docType}`,
    kind: "form",
    appId,
    docType,
    title: label,
    sections: [{ title: "Details", fields: ["title"] }],
    fields: [{ name: "title", type: "text", label: "Title", required: true }]
  };
  const view: ViewDefinition = {
    _id: `view:${docType}`,
    kind: "view",
    appId,
    docType,
    title: `${label} list`,
    columns: [{ field: "payload.title", label: "Title" }],
    sort: [{ field: "updatedAt", direction: "desc" }]
  };
  return { form, view };
}
