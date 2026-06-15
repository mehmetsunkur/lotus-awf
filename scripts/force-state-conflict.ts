import type { BusinessDocument, WorkflowDefinition } from "../src/shared/types";
import { applyTransition } from "../src/shared/workflow";
import { ensureDb, getDoc, putDoc, replicateBidirectional } from "../src/server/couch";
import { createExpenseDoc } from "../src/server/seed-data";

const timestamp = () => new Date().toISOString();

/**
 * Seed a concurrent-transition conflict (the M3 conflict class): one submitted
 * document advanced to different terminal states on two replicas while "offline".
 * After sync the document has _conflicts whose revisions disagree on `state`,
 * which the reconcile pass surfaces and the conflict UI resolves.
 */
async function main() {
  await ensureDb("local");
  await ensureDb("server");

  const def = await getDoc<WorkflowDefinition>("local", "workflow:expense");

  // Create a submitted expense and replicate it to both replicas.
  const base = createExpenseDoc({ amount: 90, description: "State conflict seed", spentAt: "2026-06-13" });
  const submitted = applyTransition(base, def, "submit", "user:alice", ["role:finance"], timestamp());
  if (!submitted.ok) throw new Error(`submit failed: ${submitted.errors[0]?.message}`);
  await putDoc("local", submitted.document);
  await replicateBidirectional();

  const localBase = await getDoc<BusinessDocument>("local", base._id);
  const serverBase = await getDoc<BusinessDocument>("server", base._id);

  // Diverge: approve on local, reject on server — both from `submitted`.
  const approved = applyTransition(localBase, def, "approve", "user:alice", ["role:finance"], timestamp());
  const rejected = applyTransition(serverBase, def, "reject", "user:alice", ["role:finance"], timestamp());
  if (!approved.ok || !rejected.ok) throw new Error("divergent transitions failed");
  await putDoc("local", { ...approved.document, updatedAt: timestamp() });
  await putDoc("server", { ...rejected.document, updatedAt: timestamp() });

  await replicateBidirectional();
  const conflicted = await getDoc<BusinessDocument>("local", base._id, "?conflicts=true");
  console.log(
    JSON.stringify(
      { id: base._id, winningState: conflicted.state, conflicts: conflicted._conflicts ?? [] },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
