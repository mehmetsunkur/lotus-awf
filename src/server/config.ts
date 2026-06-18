const localCouchUrl = process.env.LOCAL_COUCH_URL ?? "http://admin:password@localhost:5985";
const serverCouchUrl = process.env.SERVER_COUCH_URL ?? "http://admin:password@localhost:5984";

export const config = {
  appDb: process.env.APP_DB ?? "expense_app",
  appUser: process.env.APP_USER ?? "user:alice",
  localCouchUrl,
  serverCouchUrl,
  localReplicationUrl:
    process.env.LOCAL_COUCH_REPLICATION_URL ??
    (localCouchUrl.includes("localhost:5985") ? "http://admin:password@local-couchdb:5984" : localCouchUrl),
  serverReplicationUrl:
    process.env.SERVER_COUCH_REPLICATION_URL ??
    (serverCouchUrl.includes("localhost:5984") ? "http://admin:password@server-couchdb:5984" : serverCouchUrl),
  apiPort: Number(process.env.API_PORT ?? 3001),
  autoSetup: process.env.APP_AUTO_SETUP === "1"
};
