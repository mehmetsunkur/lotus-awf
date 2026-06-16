import type { FieldType, FormDefinition } from "./types";

/**
 * Full-text search (M9). The matcher is pure and portable: it runs identically
 * in the browser, on the API server, and against the local replica, so search
 * behaves the same offline-on-device and server-side (no new substrate, no
 * Lucene/Pouch — see docs/decisions/0004-search-as-shared-matcher.md). The
 * server fetches an ACL-scoped candidate set (the existing view/`findDocs`
 * path) and applies these functions; this module never does I/O.
 *
 * Semantics (deterministic, locale-independent): case-insensitive, accent-folded
 * (NFD + combining-mark strip), whitespace/punctuation tokenized, AND-of-terms
 * with prefix matching, ranked by field-weighted hit count. No stemming/stopwords.
 */

/** A doc-shaped value the matcher can read searchable text from. */
export type SearchableDoc = { payload: Record<string, unknown> };

export type SearchableField = { name: string; weight: number };

/** Field types whose values are searchable by default when no flag is set. */
const TEXTISH: ReadonlySet<FieldType> = new Set<FieldType>(["text", "textarea", "select"]);

/** Unicode combining marks (NFD leaves these after decomposing accents). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Fold to a canonical comparison form: decompose accents, drop combining marks,
 * lowercase. Portable (no Intl/locale dependence) so client and server agree.
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/** Split folded text into alphanumeric tokens, dropping empties. */
export function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Which fields a form exposes to search. A field is searchable when it opts in
 * (`searchable: true`) or — for back-compat with M1–M6 forms that set no flag —
 * when it is a text-ish type and has not opted out (`searchable: false`).
 */
export function searchableFields(form: FormDefinition): SearchableField[] {
  return form.fields
    .filter((field) => field.searchable === true || (field.searchable === undefined && TEXTISH.has(field.type)))
    .map((field) => ({ name: field.name, weight: 1 }));
}

/** Flatten an arbitrary payload value to searchable text. */
function valueText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valueText).join(" ");
  if (typeof value === "object") return Object.values(value).map(valueText).join(" ");
  return String(value);
}

/**
 * Score a document against the query terms. Returns the summed field-weighted
 * prefix-hit count, or `null` when any term matches no searchable field
 * (AND-of-terms: every term must hit something for the doc to match).
 */
export function scoreDocument(doc: SearchableDoc, fields: SearchableField[], terms: string[]): number | null {
  let total = 0;
  for (const term of terms) {
    let termScore = 0;
    for (const field of fields) {
      for (const token of tokenize(valueText(doc.payload[field.name]))) {
        if (token.startsWith(term)) termScore += field.weight;
      }
    }
    if (termScore === 0) return null;
    total += termScore;
  }
  return total;
}

/**
 * Filter `docs` to those matching `query` and order by descending score. An
 * empty query is a passthrough that preserves the caller's order (the server's
 * ACL/sort order). Equal scores keep their input order (stable).
 */
export function searchDocuments<T extends SearchableDoc>(docs: T[], form: FormDefinition, query: string): T[] {
  const terms = tokenize(query);
  if (terms.length === 0) return docs;
  const fields = searchableFields(form);
  if (fields.length === 0) return [];
  const scored: Array<{ doc: T; score: number; index: number }> = [];
  docs.forEach((doc, index) => {
    const score = scoreDocument(doc, fields, terms);
    if (score !== null) scored.push({ doc, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.doc);
}
