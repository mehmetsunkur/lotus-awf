# 05 — Acceptance

## Demo scenario

1. Reset/seed the app.
2. Open an expense; confirm the `gross` field is filled by the `expense-total-with-tax` handler and
   is read-only.
3. Change the amount; confirm `gross` recomputes live with no save and no server round-trip.
4. Create an expense via the API; confirm the persisted payload carries the same computed `gross`
   (client/server parity).
5. Submit a draft expense; confirm the response reports the `audit-transition` effect ran and the
   state advanced to `submitted`.
6. Read `GET /api/plugins/log`; confirm the transition was logged.
7. Read `GET /api/plugins/manifest`; confirm both handlers are listed with their kind.
8. Try to save a definition referencing an unknown or wrong-kind handler; confirm it is rejected.
9. `extract` the app definitions to files and `apply` them back; confirm a clean roundtrip.

## Exit criteria

M7 is complete when the project can prove:

- a pure handler derives a field value identically on client and server, offline;
- a definition referencing an unknown or wrong-kind handler is rejected on both tiers (fail closed);
- a transition effect runs server-side after the authoritative write and is observable;
- an effect failure neither blocks nor reverts the transition;
- the definitions-as-code CLI extracts and applies definitions through the existing promotion API.
