import { ulid } from "ulid";
import type { BusinessDocument } from "../src/shared/types";
import { ensureDb, getDoc, putDoc, replicateBidirectional } from "../src/server/couch";
import { createExpenseDoc } from "../src/server/seed-data";

const timestamp = () => new Date().toISOString();

async function main() {
  await ensureDb("local");
  await ensureDb("server");

  const doc = createExpenseDoc({ amount: 77, description: "Script conflict seed", spentAt: "2026-06-12" });
  const localPut = await putDoc("local", doc);
  await replicateBidirectional();

  const localBase = await getDoc<BusinessDocument>("local", doc._id);
  const serverBase = await getDoc<BusinessDocument>("server", doc._id);

  await putDoc("local", {
    ...localBase,
    payload: { ...localBase.payload, description: `Local edit ${ulid()}` },
    updatedAt: timestamp()
  });
  await putDoc("server", {
    ...serverBase,
    payload: { ...serverBase.payload, description: `Server edit ${ulid()}` },
    updatedAt: timestamp()
  });

  await replicateBidirectional();
  const conflicted = await getDoc<BusinessDocument>("local", doc._id, "?conflicts=true");
  console.log(JSON.stringify({ id: doc._id, baseRev: localPut.rev, conflicts: conflicted._conflicts ?? [] }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
