import { bulkDocs, ensureDb } from "../src/server/couch";
import { seedDocuments } from "../src/server/seed-data";

async function main() {
  for (const target of ["local", "server"] as const) {
    await ensureDb(target);
    await bulkDocs(target, seedDocuments());
    console.log(`Seeded ${target} CouchDB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
