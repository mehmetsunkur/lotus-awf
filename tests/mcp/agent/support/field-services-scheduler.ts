import type { BusinessDocument } from "../../../../src/shared/types";
import type { FieldPersonaName } from "./field-services";

export type FieldServiceDocSet = {
  serviceRequests: BusinessDocument[];
  workOrders: BusinessDocument[];
  partsReservations: BusinessDocument[];
  invoices: BusinessDocument[];
};

export type FieldSpawnDecision = {
  persona: FieldPersonaName;
  shouldSpawn: boolean;
  reason: string;
  itemIds: string[];
};

export const FIELD_SCHEDULER_ORDER: FieldPersonaName[] = ["dana", "taylor", "iris", "blake"];

const byUpdated = (left: BusinessDocument, right: BusinessDocument) =>
  (left.responsibleAt ?? left.updatedAt ?? left.createdAt).localeCompare(right.responsibleAt ?? right.updatedAt ?? right.createdAt) ||
  left._id.localeCompare(right._id);

function hasSentInvoice(invoices: BusinessDocument[], workOrderId: string): boolean {
  return invoices.some((invoice) => invoice.payload.workOrderRef === workOrderId && invoice.state === "sent");
}

function openBillingInvoices(invoices: BusinessDocument[]): BusinessDocument[] {
  return invoices.filter((invoice) => invoice.state === "draft" || invoice.state === "disputed" || invoice.state === undefined);
}

export function decideFieldServiceSpawn(persona: FieldPersonaName, docs: FieldServiceDocSet): FieldSpawnDecision {
  if (persona === "dana") {
    const requests = docs.serviceRequests.filter((doc) => doc.state === "triaged").sort(byUpdated);
    return decision(persona, requests, requests.length ? `triaged service request${plural(requests)}` : "no triaged service requests");
  }

  if (persona === "taylor") {
    const orders = docs.workOrders
      .filter((doc) => doc.state === undefined || doc.state === "scheduled" || doc.state === "parts-ready")
      .sort(byUpdated);
    const pickups = docs.partsReservations.filter((doc) => doc.state === "allocated").sort(byUpdated);
    const items = [...orders, ...pickups];
    return decision(
      persona,
      items,
      items.length ? `technician work ready (${orders.length} work orders, ${pickups.length} reservations)` : "no scheduled or parts-ready technician work"
    );
  }

  if (persona === "iris") {
    const reservations = docs.partsReservations
      .filter((doc) => doc.state === undefined || doc.state === "requested" || doc.state === "backordered")
      .sort(byUpdated);
    const orders = docs.workOrders.filter((doc) => doc.state === "needs-parts").sort(byUpdated);
    const items = [...reservations, ...orders];
    return decision(
      persona,
      items,
      items.length ? `inventory work ready (${reservations.length} reservations, ${orders.length} work orders)` : "no requested parts or needs-parts work orders"
    );
  }

  const uninvoicedCompleted = docs.workOrders
    .filter((doc) => doc.state === "completed" && !hasSentInvoice(docs.invoices, doc._id))
    .sort(byUpdated);
  const invoices = openBillingInvoices(docs.invoices).sort(byUpdated);
  const items = [...uninvoicedCompleted, ...invoices];
  return decision(
    persona,
    items,
    items.length
      ? `billing work ready (${uninvoicedCompleted.length} completed work orders, ${invoices.length} invoices)`
      : "no uninvoiced completed work orders or open invoices"
  );
}

export function nextFieldServiceSpawn(docs: FieldServiceDocSet): FieldSpawnDecision | undefined {
  return FIELD_SCHEDULER_ORDER.map((persona) => decideFieldServiceSpawn(persona, docs)).find((decision) => decision.shouldSpawn);
}

function decision(persona: FieldPersonaName, items: BusinessDocument[], reason: string): FieldSpawnDecision {
  return { persona, shouldSpawn: items.length > 0, reason, itemIds: items.map((doc) => doc._id) };
}

function plural(items: unknown[]): string {
  return items.length === 1 ? "" : "s";
}
