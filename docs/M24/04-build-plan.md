# 04 - Build Plan

1. Add M24 specs and acceptance criteria.
2. Add the MCP SDK dependency and stdio server entrypoint.
3. Add a Lotus API client with session-cookie login and typed HTTP errors.
4. Add read-only MCP tools for session, platform, apps, definitions, workflows, scaffold options,
   template export, and template diff.
5. Move pure template validation to shared code and reuse it from server and MCP.
6. Add creation tools for document types and approval workflow scaffolds.
7. Add pure workflow patch helpers and tests.
8. Add preview/apply workflow patch tools.
9. Run build/unit verification and record any unavailable e2e/deploy gates.
