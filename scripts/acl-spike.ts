import { couchRequest, deleteDb, ensureDb, getDoc, putDoc } from "../src/server/couch";
import type { BusinessDocument } from "../src/shared/types";
import { config } from "../src/server/config";

type UserScope = {
  user: string;
  roles: string[];
  db: string;
};

const scopes: UserScope[] = [
  { user: "user:alice", roles: ["role:finance"], db: `${config.appDb}_alice_acl_spike` },
  { user: "user:bob", roles: ["role:sales"], db: `${config.appDb}_bob_acl_spike` }
];

const localDbUrl = (db: string) => `${config.localCouchUrl}/${db}`;
const serverDbUrl = () => `${config.serverCouchUrl}/${config.appDb}`;

async function countDocs(db: string) {
  const result = await couchRequest<{ rows: Array<{ id: string; doc?: BusinessDocument }> }>(
    "local",
    `/${db}/_all_docs?include_docs=true`
  );
  return result.rows
    .map((row) => row.doc)
    .filter((doc): doc is BusinessDocument => Boolean(doc?.kind === "document"));
}

async function replicateScope(scope: UserScope) {
  await ensureDb("local", scope.db);
  return couchRequest("local", "/_replicate", {
    method: "POST",
    body: JSON.stringify({
      source: serverDbUrl(),
      target: localDbUrl(scope.db),
      create_target: true,
      selector: {
        readers: {
          $in: [scope.user, ...scope.roles]
        }
      }
    })
  });
}

async function main() {
  for (const scope of scopes) {
    await deleteDb("local", scope.db);
    await replicateScope(scope);
  }

  const initial = Object.fromEntries(
    await Promise.all(scopes.map(async (scope) => [scope.user, (await countDocs(scope.db)).map((doc) => doc._id)]))
  );

  const bobDocs = await countDocs(scopes[1].db);
  const revokedId = bobDocs[0]?._id;
  let afterRevocation: string[] = [];

  if (revokedId) {
    const serverDoc = await getDoc<BusinessDocument>("server", revokedId);
    await putDoc("server", {
      ...serverDoc,
      readers: serverDoc.readers.filter((reader) => reader !== "user:bob" && reader !== "role:sales")
    });
    await replicateScope(scopes[1]);
    afterRevocation = (await countDocs(scopes[1].db)).map((doc) => doc._id);
  }

  console.log(
    JSON.stringify(
      {
        result: "conditional",
        initial,
        revokedId,
        afterRevocation,
        finding:
          "Selector-based filtered replication can limit incoming documents for different users, but this spike does not prove automatic purge of documents already replicated before access was revoked."
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
