import type { ViewFilter } from "./types";

/**
 * ADR-0020: reserved actor-aware filter value. Valid only with `op: "in"` and
 * only as the ENTIRE filter value (shared validation enforces both); at query
 * time the server substitutes the caller's full principal set.
 */
export const ME_SENTINEL = "@me";

/**
 * Build the Mango selector for a view's authored filters. Pure and
 * unit-testable; the server spreads `accessSelector(scope)` over the result so
 * ACL filtering always applies LAST — an authored predicate can narrow the
 * ACL-scoped set but never widen it (and `readers`/`authors` filters are
 * rejected at authoring because that spread makes them dead).
 *
 * `principals` is REQUIRED (review M5): every caller must decide whose identity
 * `@me` resolves to. An empty set substitutes `$in: []`, which matches nothing —
 * fail-closed — and `$in` never matches an absent field, so e.g. an
 * assignee-less document appears in nobody's personal inbox.
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
