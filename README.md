# Agent Budget Billing

Monorepo skeleton for the Dodo x Solana hackathon build.

## Packages

- `gateway/`: request proxy, auth, usage metering, Dodo webhook handling
- `program/`: Solana Anchor program for settlement window commitments
- `dashboard/`: operator UI for budgets, runs, settlement status, and billing
- `agent/`: autonomous agent runtime that spends against a user budget

## Current goal

Get the Apr 27 plan working:

1. Repo skeleton
2. Postgres schema
3. Dumb proxy
4. Dodo webhook + budget creation
5. Budget decrement per call
6. Manual `X-Solana-Tx` fallback verifier
