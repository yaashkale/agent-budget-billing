# Gateway

Responsibilities:

- proxy requests at `/p/:slug/*`
- authenticate human calls via API key
- authenticate agent calls via x402 or fallback Solana tx verification
- record usage events
- receive Dodo webhooks
- update user budgets

## Current v1 route

- `GET /health`
- `ALL /p/wallet-summary?address=<solana-address>&cluster=devnet`
- `POST /webhooks/dodo`
- `GET /dev/budgets`
- `GET /dev/usage-events`
- `GET /dev/payments`
- `POST /verify/solana-tx`

The current proxy forwards to publisher 0's Next.js route:

- `http://localhost:3000/api/wallet-summary`

## Current auth behavior

- Human path requires `X-API-Key`
- Current dev key default: `dev-human-key`
- Missing key returns `401`
- Invalid key returns `403`

This is temporary dev auth before DB-backed key lookup is wired.

## Current webhook behavior

- Accepts Dodo-style subscription payloads at `POST /webhooks/dodo`
- Optional dev signature check via `DODO_WEBHOOK_SECRET`
- Creates or refreshes an in-memory budget record
- Generates an API key for the subscriber if needed
- Returns the current dev API key in the webhook response so local testing is fast

## Current budget behavior

- In-memory only for now
- Seeded dev budget for `dev-human-key`
- `GET /dev/budgets` shows the current loaded budget records
- Successful wallet-summary calls debit the caller budget
- Current default call cost: `50_000` micro-USDC (`$0.05`)
- If balance is too low, the gateway returns `402`

## Current usage-event behavior

- Successful human wallet-summary calls create an in-memory usage event
- `GET /dev/usage-events` shows the latest recorded events
- Gateway returns `x-usage-event-id` on successful paid calls

## Current Solana fallback behavior

- Agent-style access can use `X-Solana-Tx` instead of `X-API-Key`
- Gateway verifies the provided transaction against the configured recipient wallet on Solana RPC
- Verified signatures are treated as single-use
- `GET /dev/payments` shows verified/consumed manual payments
- `POST /verify/solana-tx` exposes the verifier directly for debugging
