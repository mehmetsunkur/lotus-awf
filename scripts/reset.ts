import { bulkDocs, createIndex, deleteDb, ensureDb } from "../src/server/couch";
import { seedDocuments } from "../src/server/seed-data";

async function ensureIndexes(target: "local" | "server") {
  await createIndex(target, "m2-kind-docType-updatedAt", ["kind", "docType", "updatedAt"]);
  await createIndex(target, "m3-docType-state-updatedAt", ["docType", "state", "updatedAt"]);
}

async function main() {
  for (const target of ["local", "server"] as const) {
    await deleteDb(target);
    await ensureDb(target);
    await bulkDocs(target, seedDocuments());
    await ensureIndexes(target);
    console.log(`Reset and seeded ${target} CouchDB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
