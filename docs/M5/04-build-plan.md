# 04 — Build Plan

## Step 1 — Docs and shared policy

Add M5 docs and shared access helpers.

## Step 2 — Server enforcement

Use the shared policy in list, option, document save/delete, workflow transition, filtered pull, and
revocation purge paths.

## Step 3 — Tests and review

Add e2e/API tests for scoped reads, option leakage, write refusal, transition behavior, and revocation
purge. Run build, e2e, and the Tier-3 review workflow if available.
