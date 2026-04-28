# 00 Build Log

Date started: 2026-04-28
Project: agent-budget-billing

## Purpose

This file is the running log of what we are doing while building the project.
Anything meaningful we finish or decide should be appended here so the build context stays with the repo.

## Completed so far

### 2026-04-28

- Created a clean project directory at `/Users/yashkale/SolanaProjects/agent-budget-billing`.
- Chose the working project name: `agent-budget-billing`.
- Scaffolded the initial repo skeleton:
  - `gateway/`
  - `dashboard/`
  - `agent/`
  - `program/`
- Added root workspace files:
  - `package.json`
  - `.gitignore`
  - `README.md`
- Added initial package stubs for:
  - `gateway`
  - `dashboard`
  - `agent`
  - `program`
- Created this `docs/` folder to keep repo-local build notes and readme-style files.
- Added the first database migration at `db/migrations/001_initial_schema.sql`.
- Defined the initial Postgres schema for:
  - `publishers`
  - `pricing_rules`
  - `dodo_subscriptions`
  - `api_keys`
  - `user_budgets`
  - `agent_runs`
  - `x402_payments`
  - `settlement_windows`
  - `usage_events`
- Added indexes and basic constraints so Day 1 flows have a real persistence model to build against.
- Replaced the gateway stub with a real Hono skeleton in `gateway/src/index.ts`.
- Added the first working proxy target:
  - `GET /health`
  - `ALL /p/wallet-summary?address=...&cluster=devnet`
- Wired the dumb proxy to forward to publisher 0's existing route at `http://localhost:3000/api/wallet-summary`.
- Installed gateway dependencies successfully (`hono`, `@hono/node-server`, `tsx`, `typescript`).
- Verified:
  - gateway health endpoint responds on `http://localhost:8787/health`
  - publisher 0 endpoint responds on `http://localhost:3000/api/wallet-summary`
  - gateway proxy forwards correctly on `http://localhost:8787/p/wallet-summary?...`
- Added minimal human auth middleware to the gateway.
- `X-API-Key` is now required on the wallet-summary proxy route.
- Current dev behavior:
  - missing key => `401`
  - invalid key => `403`
  - default dev key => `dev-human-key`
- Verified API-key gating end-to-end:
  - no key returns `401`
  - wrong key returns `403`
  - `X-API-Key: dev-human-key` returns the proxied wallet-summary JSON successfully
- Added `POST /webhooks/dodo` to the gateway.
- Webhook now accepts a Dodo-style subscription payload and upserts an in-memory budget record.
- Added a temporary in-memory budget store keyed by subscription id and API key.
- Added `GET /dev/budgets` for local inspection of current loaded budgets.
- Webhook currently returns the generated dev API key in the response so local testing is fast before DB persistence is wired.
- Verified Dodo-style webhook flow locally:
  - POSTing `subscription.renewed` creates a new budget record
  - the webhook response returns a generated API key
  - `/dev/budgets` shows the new active budget
  - the generated API key successfully authorizes the wallet-summary proxy route
- Added first budget debit logic for successful human wallet-summary calls.
- Current default call cost: `50_000` micro-USDC (`$0.05`).
- Gateway now returns:
  - `402` if balance is too low
  - updated budget balance in response headers after a successful call
- Verified successful paid call behavior:
  - webhook-created budget started at `50,000,000` micro-USDC
  - one wallet-summary call succeeded
  - returned headers showed:
    - `x-call-cost-usdc-micros: 50000`
    - `x-budget-balance-usdc-micros: 49950000`
  - so budget debit is now real on the human path
- Added in-memory usage-event recording for successful human wallet-summary calls.
- Added `GET /dev/usage-events` to inspect the latest recorded events.
- Successful paid calls now return `x-usage-event-id`.
- Verified usage-event recording end-to-end:
  - fresh webhook-created budget used for one successful paid call
  - response returned `x-usage-event-id`
  - `/dev/usage-events` shows the recorded event with:
    - owner email
    - subscription id
    - endpoint path
    - billed amount
    - post-call budget balance
    - timestamp
- Added the manual Solana fallback verifier shape:
  - `X-Solana-Tx` header support on the proxy path
  - Solana RPC-based verification against the configured recipient wallet
  - single-use payment consumption tracking
  - `/dev/payments` inspection route
  - `/verify/solana-tx` direct debug route
- Installed `@solana/web3.js` and restarted the gateway with Solana fallback support.
- Verified current fallback behavior:
  - `/health` exposes `solanaRpcUrl` and configured `solanaRecipient`
  - calling the proxy with neither `X-API-Key` nor `X-Solana-Tx` returns `402`
  - `POST /verify/solana-tx` with no signature returns `400`
- Completed end-to-end manual fallback verification on a local Solana validator:
  - created a throwaway payer wallet
  - funded it on a local validator
  - sent a real transfer to the configured recipient wallet
  - `POST /verify/solana-tx` accepted the real signature
  - proxy call with `X-Solana-Tx` succeeded and returned:
    - `x-solana-payment-signature`
    - `x-solana-payment-lamports`
    - `x-usage-event-id`
  - `/dev/payments` shows the verified payment as consumed (single-use behavior works)

## Current next step

- Day 27 is functionally complete. Move to the Apr 28 plan.

## Logging rule

- Append meaningful build progress here as we move.
