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
- `ALL /p/holder-distribution?address=<token-mint-or-target-address>&cluster=devnet`
- `POST /webhooks/dodo`
- `GET /dev/budgets`
- `GET /dev/usage-events`
- `GET /dev/payments`
- `POST /verify/solana-tx`
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/report`
- `GET /demo`
- `GET /demo/runs/:id`

The current proxy forwards to publisher 0's Next.js route:

- `http://localhost:3000/api/wallet-summary`

The holder-distribution tool is wired separately:

- uses deterministic mock data when `HELIUS_API_KEY` is not configured
- can use Helius-backed RPC holder concentration queries when the key is present

## Current auth behavior

- Human path requires `X-API-Key`
- Current dev key default: `dev-human-key`
- Missing key returns `401`
- Invalid key returns `403`
- If `DATABASE_URL` is set, API-key lookup is performed against Postgres first and
  falls back to in-memory dev state only when DB persistence is not configured.

## Current webhook behavior

- Accepts Dodo-style subscription payloads at `POST /webhooks/dodo`
- Optional dev signature check via `DODO_WEBHOOK_SECRET`
- Creates or refreshes a Postgres-backed budget record when `DATABASE_URL` is set
- Falls back to in-memory budget records in pure local-dev mode
- Generates an API key for the subscriber if needed
- Returns the current dev API key in the webhook response so local testing is fast

## Current budget behavior

- Hybrid for now:
  - Postgres-backed when `DATABASE_URL` is configured
  - in-memory fallback for local dev without a database
- Seeded dev budget for `dev-human-key`
- `GET /dev/budgets` shows the current loaded budget records
- Successful wallet-summary calls debit the caller budget
- Current default call cost: `50_000` micro-USDC (`$0.05`)
- If balance is too low, the gateway returns `402`

## Current usage-event behavior

- When `DATABASE_URL` is configured, successful API-key-funded calls persist
  `usage_events` to Postgres
- This includes both:
  - direct human proxy calls
  - agent-funded tool calls inside `POST /api/runs`
- Postgres-backed usage events now store the charged `budget_id` directly for
  stable ledger reads
- Manual `X-Solana-Tx` fallback calls still use in-memory event recording until
  `x402_payments` persistence is wired
- `GET /dev/usage-events` reads from Postgres when available and falls back to
  in-memory state otherwise
- Gateway returns `x-usage-event-id` on successful paid calls

## Current Solana fallback behavior

- Agent-style access can use `X-Solana-Tx` instead of `X-API-Key`
- Gateway verifies the provided transaction against the configured recipient wallet on Solana RPC
- Verified signatures are treated as single-use
- `GET /dev/payments` shows verified/consumed manual payments
- `POST /verify/solana-tx` exposes the verifier directly for debugging

## Current agent runtime behavior

- `POST /api/runs` requires `X-API-Key` plus:
  - `prompt`
  - `targetAddress`
  - optional `publisherSlug`
  - optional `cluster`
- run state is in-memory only
- planner v0 now performs five real paid tool calls:
  - `wallet_summary`
  - `recent_activity`
  - `holder_distribution`
  - `risk_flags`
  - `llm_analysis`
- successful runs debit budget and create usage events with `callerType: "agent"`
- `GET /api/runs` lists current runs
- `GET /api/runs/:id` returns one run
- `GET /api/runs/:id/report` returns a presentation-friendly report payload plus markdown
- `GET /demo` returns a browser launcher for creating runs and browsing recent ones
- `GET /demo/runs/:id` returns an HTML demo page for the run
- `llm-analysis` is an internal synthesis tool:
  - uses OpenAI Responses API when `OPENAI_API_KEY` is configured
  - falls back to deterministic local synthesis when the key is missing
- the final brief/report is now driven by the `llm_analysis` tool output rather
  than only deterministic template logic
