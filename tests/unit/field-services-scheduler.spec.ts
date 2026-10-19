import { describe, expect, it } from "vitest";
import type { BusinessDocument } from "../../src/shared/types";
import {
  decideFieldServiceSpawn,
  nextFieldServiceSpawn,
  type FieldServiceDocSet
} from "../mcp/agent/support/field-services-scheduler";

const emptyDocs = (): FieldServiceDocSet => ({
  serviceRequests: [],
  workOrders: [],
  partsReservations: [],
  invoices: []
});

function doc(docType: string, id: string, state: string | undefined, payload: Record<string, unknown> = {}): BusinessDocument {
  return {
    _id: `doc:${docType}:${id}`,
    kind: "document",
    appId: "agent-field-services",
    docType,
    createdAt: `2026-08-01T00:00:${id.padStart(2, "0")}.000Z`,
    updatedAt: `2026-08-01T00:00:${id.padStart(2, "0")}.000Z`,
    createdBy: "person:alice",
    updatedBy: "person:alice",
    authors: ["person:alice"],
    payload,
    ...(state ? { state } : {})
  };
}

describe("Field Services scheduler policy", () => {
  it("spawns dispatch for triaged service requests", () => {
    const docs = emptyDocs();
    docs.serviceRequests.push(doc("service-request", "01", "new"), doc("service-request", "02", "triaged"));

    const decision = decideFieldServiceSpawn("dana", docs);

    expect(decision.shouldSpawn).toBe(true);
    expect(decision.itemIds).toEqual(["doc:service-request:02"]);
  });

  it("spawns the technician for scheduled work orders even without a responsible stamp", () => {
    const docs = emptyDocs();
    docs.workOrders.push(doc("work-order", "01", undefined), doc("work-order", "02", "parts-ready"));

    const decision = decideFieldServiceSpawn("taylor", docs);

    expect(decision.shouldSpawn).toBe(true);
    expect(decision.itemIds).toEqual(["doc:work-order:01", "doc:work-order:02"]);
  });

  it("spawns inventory for requested reservations and needs-parts work orders", () => {
    const docs = emptyDocs();
    docs.partsReservations.push(doc("parts-reservation", "01", undefined));
    docs.workOrders.push(doc("work-order", "02", "needs-parts"));

    const decision = decideFieldServiceSpawn("iris", docs);

    expect(decision.shouldSpawn).toBe(true);
    expect(decision.itemIds).toEqual(["doc:parts-reservation:01", "doc:work-order:02"]);
  });

  it("spawns billing for completed work orders until a linked invoice is sent", () => {
    const docs = emptyDocs();
    const order = doc("work-order", "01", "completed");
    docs.workOrders.push(order);

    expect(decideFieldServiceSpawn("blake", docs).shouldSpawn).toBe(true);

    docs.invoices.push(doc("invoice", "02", "draft", { workOrderRef: order._id }));
    const withDraft = decideFieldServiceSpawn("blake", docs);
    expect(withDraft.shouldSpawn).toBe(true);
    expect(withDraft.itemIds).toEqual([order._id, "doc:invoice:02"]);

    docs.invoices[0] = doc("invoice", "02", "sent", { workOrderRef: order._id });
    const withSent = decideFieldServiceSpawn("blake", docs);
    expect(withSent.shouldSpawn).toBe(false);
  });

  it("chooses the next persona in company scheduler order", () => {
    const docs = emptyDocs();
    docs.workOrders.push(doc("work-order", "01", "completed"), doc("work-order", "02", "scheduled"));

    expect(nextFieldServiceSpawn(docs)?.persona).toBe("taylor");
  });
});
