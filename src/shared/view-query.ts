import type { ViewFilter } from "./types";

/**
 * ADR-0020: reserved actor-aware filter value. Valid only with `op: "in"` and
 * only as the ENTIRE filter value (shared validation enforces both); at query
 * time the server substitutes the caller's full principal set.
 */
export const ME_SENTINEL = "@me";

/**
 * Build the Mango selector for a view's authored filters. Pure and
 * unit-testable. ADR-0026: there is no per-document ACL selector — the app ACL
 * gates the route — so the server re-asserts `kind: "document"` LAST, ensuring an
 * authored predicate can only narrow the business-document set, never reach
 * design/runtime docs (`readers`/`authors` filters stay rejected at authoring).
 *
 * `principals` is REQUIRED (review M5): every caller must decide whose identity
 * `@me` resolves to. An empty set substitutes `$in: []`, which matches nothing —
 * fail-closed — and `$in` never matches an absent field, so e.g. a document with
 * no `responsible`/`assignee` appears in nobody's personal inbox. Against an ARRAY
 * field (`responsible`, ADR-0025) `$in` matches on element membership.
 */
export function mangoSelector(
  filters: ViewFilter[] = [],
  docType: string | undefined,
  principals: string[]
): Record<string, unknown> {
  const selector: Record<string, unknown> = { kind: "document" };
  if (docType) selector.docType = docType;

  for (const filter of filters) {
    const op = filter.op === "eq" ? "$eq" : filter.op === "ne" ? "$ne" : `$${filter.op}`;
    const value = filter.value === ME_SENTINEL ? [...principals] : filter.value;
    selector[filter.field] = { [op]: value };
  }

  return selector;
}
