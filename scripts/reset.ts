import { bulkDocs, deleteDb, ensureDb } from "../src/server/couch";
import { seedDocuments } from "../src/server/seed-data";

async function main() {
  for (const target of ["local", "server"] as const) {
    await deleteDb(target);
    await ensureDb(target);
    await bulkDocs(target, seedDocuments());
    console.log(`Reset and seeded ${target} CouchDB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
