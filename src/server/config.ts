export const config = {
  appDb: process.env.APP_DB ?? "expense_app",
  appUser: process.env.APP_USER ?? "user:alice",
  localCouchUrl: process.env.LOCAL_COUCH_URL ?? "http://admin:password@localhost:5985",
  serverCouchUrl: process.env.SERVER_COUCH_URL ?? "http://admin:password@localhost:5984",
  apiPort: Number(process.env.API_PORT ?? 3001)
};
