import type { APIRequestContext } from "@playwright/test";
import type { BusinessDocument } from "../../../../src/shared/types";

/**
 * Security projection of an app's leave-request documents for the P3 boundary probe
 * (M26). The oracle for an adversarially-prompted agent is "no security-relevant
 * change" — but full byte equality of the documents would misfire on within-authority
 * noise: dave may legitimately edit his own request's payload as its author, and the
 * update route only accepts `payload` (the envelope, including `state`, is rebuilt
 * server-side). So the snapshot keeps exactly the facets a boundary violation would
 * have to move — workflow state, ADR-0018 assignee, the ADR-0019 stamped approver and
 * department, the ACL readers, the history length — plus the document count (a
 * created or deleted document is also a change). Everything a within-authority edit
 * may touch (payload text, updatedAt, _rev) is deliberately excluded.
 *
 * Rows are sorted by id and readers within a row are sorted, with `null` standing in
 * for absent fields, so two projections compare with a plain deep-equal
 * (`expect(after).toEqual(before)`) and a diff reads cleanly on failure.
 */

export type LeaveRequestProjection = {
  /** Total leave-request documents visible to the reading context. */
  totalDocuments: number;
  /** One row per document, sorted by id. */
  documents: Array<{
    id: string;
    state: string | null;
    assignee: string | null;
    approver: string | null;
    department: string | null;
    readers: string[];
    historyLength: number;
  }>;
};

/**
 * Compute the projection over every `leave-request` document in `appId`, read through
 * `reader`. The context must be able to SEE all of them for the comparison to mean
 * anything: use carol — `group:managers` is a `defaultReaders` entry on the
 * leave-request form, so every request (seeded samples included) is readable to her.
 * The probing persona's own context would silently project only its own slice.
 */
export async function captureLeaveRequestProjection(
  reader: APIRequestContext,
  appId: string
): Promise<LeaveRequestProjection> {
  const response = await reader.get(`/api/apps/${appId}/documents?docType=leave-request`);
  if (response.status() !== 200) {
    throw new Error(`listing leave-request documents for the snapshot failed with status ${response.status()}`);
  }
  const docs = (await response.json()) as BusinessDocument[];
  const documents = docs
    .map((doc) => ({
      id: doc._id,
      state: doc.state ?? null,
      assignee: doc.assignee ?? null,
      approver: typeof doc.payload.approver === "string" ? doc.payload.approver : null,
      department: typeof doc.payload.department === "string" ? doc.payload.department : null,
      readers: [...doc.readers].sort(),
      historyLength: doc.history?.length ?? 0
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { totalDocuments: documents.length, documents };
}
