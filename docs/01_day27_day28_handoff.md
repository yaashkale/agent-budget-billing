# Day 27 + Day 28 Handoff

Last updated: 2026-04-29 early morning  
Project root: `/Users/yashkale/SolanaProjects/agent-budget-billing`

## Current call

Do **not** push the current uncommitted work yet.

Reason:
- Day 27 gateway work was committed and pushed earlier.
- Day 28 agent/runtime/demo-surface work is now materially bigger.
- This next chunk should ideally get one Opus review before the next commit/push.

This document is meant to help you:
- understand what we built
- know what is real vs stubbed
- review the code during office hours
- resume cleanly when you’re back home

---

## What was completed on Day 27

Day 27 was the “gateway + billing skeleton” day.

### 1. Repo and schema foundations

We created the project structure:
- `gateway/`
- `dashboard/`
- `agent/`
- `program/`
- `db/`
- `docs/`

We also created the initial Postgres schema here:
- [db/migrations/001_initial_schema.sql](/Users/yashkale/SolanaProjects/agent-budget-billing/db/migrations/001_initial_schema.sql)

Important truth:
- the schema exists
- runtime logic is still **in-memory**
- Postgres is **not wired into the live gateway yet**

### 2. Publisher 0 / upstream

The gateway depends on your existing Next.js publisher API running separately at:
- `http://localhost:3000`

Publisher 0 endpoint:
- `/api/wallet-summary`

This is the actual data source behind the gateway.

### 3. Gateway core

The gateway runs on:
- `http://localhost:8787`

Main file:
- [gateway/src/index.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/index.ts)

Day 27 made the gateway real enough to:
- proxy paid API calls
- gate access
- debit budgets
- record usage
- accept Dodo-style webhook events
- verify manual Solana fallback payments

### 4. Human billing path

What became real:
- `X-API-Key` auth
- in-memory budget record
- budget debit per successful paid call
- usage-event recording

The gateway started doing actual “money logic” instead of just forwarding requests.

### 5. Manual Solana fallback

We added:
- `X-Solana-Tx`
- Solana RPC verification
- single-use payment consumption

Important limitation:
- current verifier checks **native SOL lamport movement**
- it does **not yet** verify real USDC SPL transfers

This is a deliberate Day 1 / Day 27 fallback.

### 6. Day 27 result

By the end of Day 27 catch-up, we had:
- proxy
- auth
- webhook
- budget creation/refill
- budget decrement
- usage events
- manual Solana fallback
- local validator proof for fallback verification

That is why we called Day 27 “functionally complete”.

---

## What was completed on Day 28

Day 28 turned the project from:
- “paid API gateway”

into:
- “funded agent run + paid tool calls + browser demo”

### 1. Agent runtime skeleton

We added:
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/:id`

At first it was a stub.
Then we upgraded it into a real paid multi-step run.

### 2. Real paid tool calls inside the run

The run now performs 3 monetized tool calls:
- `/p/wallet-summary`
- `/p/recent-activity`
- `/p/risk-flags`

Each one:
- debits budget
- records a usage event
- contributes to the final run report

### 3. Structured run artifact

The run now returns:
- `resultSummary`
- `resultArtifact`

The artifact includes:
- `headline`
- `executiveSummary`
- `findings`
- `recommendation`
- `riskLevel`
- `spendSummary`
- `sources`

So the run is no longer “just a JSON status blob”.

### 4. Report endpoint

We added:
- `GET /api/runs/:id/report`

This returns:
- structured report JSON
- a markdown report view

### 5. Demo HTML surfaces

We added:
- `GET /demo`
- `GET /demo/runs/:id`

This means:
- you now have a browser launcher page
- you can create a run from the browser
- you can open an HTML report page for a run

This is the biggest demo-quality improvement from tonight.

---

## Current file map

If you want the shortest path to understanding the current codebase, review files in this order:

1. [docs/00_build_log.md](/Users/yashkale/SolanaProjects/agent-budget-billing/docs/00_build_log.md)
2. [db/migrations/001_initial_schema.sql](/Users/yashkale/SolanaProjects/agent-budget-billing/db/migrations/001_initial_schema.sql)
3. [gateway/src/index.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/index.ts)
4. [gateway/src/agent-runtime.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/agent-runtime.ts)
5. [agent/src/index.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/agent/src/index.ts)
6. [gateway/src/report-surface.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/report-surface.ts)

---

## Architecture in plain English

Current architecture is:

1. a publisher API exists on port `3000`
2. the gateway runs on port `8787`
3. humans call the gateway using `X-API-Key`
4. agents can call the gateway using a Solana payment fallback path
5. the gateway meters usage and debits spend
6. agent runs orchestrate multiple paid calls
7. the run returns a report
8. the demo surface displays the report

So right now the gateway is acting as:
- auth layer
- billing layer
- budget layer
- metering layer
- agent run coordinator
- lightweight demo server

---

## `gateway/src/index.ts` walkthrough

File:
- [gateway/src/index.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/index.ts)

Current size:
- about 900 lines

It is too large long-term, but still manageable short-term because the pieces are now understandable.

### Section 1: scope note and imports

Lines:
- `1-22`

What this does:
- documents current constraints
- imports Hono
- imports Solana web3 types
- imports agent runtime helpers
- imports HTML report rendering helpers

Important meaning:
- this file is still the integration point for almost everything
- it is not yet split into route modules/services

### Section 2: config constants

Lines:
- `24-43`

What this defines:
- `PORT`
- `PUBLISHER_ORIGIN`
- `SOLANA_RPC_URL`
- `DEV_API_KEY`
- `DODO_WEBHOOK_SECRET`
- default budget refill amount
- per-call price in micro-USDC
- recipient Solana wallet
- lamport fallback price

How to think about these:
- this is the “runtime configuration layer”
- everything important is driven from these values

Important mental model:
- `50_000` micro-USDC = `$0.05`
- `50_000_000` micro-USDC = `$50.00`

### Section 3: in-memory data shapes

Lines:
- `48-115`

These types model the runtime state:
- `BudgetRecord`
- `DodoSubscriptionPayload`
- `UsageEventRecord`
- `VerifiedPaymentRecord`
- `WalletSummaryApiResponse`

Important truth:
- these are currently “live app memory” models
- not DB-backed models yet

### Section 4: report formatting helpers

Lines:
- `117-186`

Functions:
- `formatUsdMicros`
- `formatRunReport`
- `formatRunListForDemo`

What they do:
- convert raw run state into something presentation-friendly
- generate the JSON report shape returned by `/api/runs/:id/report`
- shape recent runs for `/demo`

This section matters because it is the bridge between:
- raw run state
and
- demo output

### Section 5: in-memory stores

Lines:
- `188-197`

These are the current live stores:
- `budgetsById`
- `budgetIdsBySubscription`
- `budgetIdsByApiKey`
- `usageEvents`
- `verifiedPaymentsBySignature`
- `ALLOWED_SLUGS`

This is why a restart resets state.

### Section 6: dev seed budget

Lines:
- `199-220`

What it does:
- seeds a local active budget
- owner email: `dev@example.com`
- API key: `dev-human-key`
- balance: `$50`

This is only seeded when:
- `NODE_ENV !== "production"`

So this is a dev convenience, not business logic.

### Section 7: human budget helpers

Lines:
- `222-309`

Functions:
- `getBudgetByApiKey`
- `ensureSufficientBudget`
- `debitBudget`
- `recordUsageEvent`

What to understand well:

#### `getBudgetByApiKey`
- reads `X-API-Key`
- missing -> `401`
- unknown -> `403`
- inactive budget -> `403`

This is the main human auth gate.

#### `ensureSufficientBudget`
- checks if a budget can afford a call
- insufficient -> `402`

This is one of the core money-logic functions.

#### `debitBudget`
- subtracts spend
- marks budget exhausted if balance hits zero
- updates in-memory record

This is the second core money-logic function.

#### `recordUsageEvent`
- creates one usage event entry
- stores endpoint path
- stores caller type
- stores billed amount
- stores balance after spend
- stores request id or payment id

This function is what makes the gateway auditable.

### Section 8: manual Solana fallback verifier

Lines:
- `311-399`

Functions:
- `verifyManualSolanaPayment`
- `markPaymentConsumed`

This is one of the most important sections to understand conceptually.

Current behavior:
- reads a tx signature
- fetches parsed transaction from Solana RPC
- checks the configured recipient wallet appears in the tx
- checks recipient balance delta in lamports
- verifies amount is big enough
- stores payment as verified
- consumes it once used

Important limitation:
- this is **not real USDC SPL verification yet**
- it is native-SOL-based fallback verification

The TODO comment in this block is important because it explicitly says what a proper USDC implementation would require.

### Section 9: Dodo webhook signature + budget upsert

Lines:
- `401-566`

Functions:
- `verifyDodoSignature`
- `createApiKey`
- `fetchWalletSummaryFromPublisher`
- `shapePublisherResponse`
- `upsertBudgetFromDodo`

#### `verifyDodoSignature`
Current state:
- weak stub
- compares header to secret directly
- TODO says replace with real HMAC

Do not mistake this for production-grade verification.

#### `fetchWalletSummaryFromPublisher`
This is important:
- all 3 monetized tools currently derive from publisher 0’s wallet-summary data
- this helper centralizes the upstream fetch

#### `shapePublisherResponse`
This is where we turn one upstream wallet-summary source into:
- `wallet-summary`
- `recent-activity`
- `risk-flags`

This is why we can have multiple paid tools without building three separate publishers yet.

#### `upsertBudgetFromDodo`
This creates or refreshes an in-memory budget from a Dodo webhook payload.

Important bug that was fixed:
- Dodo recurring amount in cents is converted to micro-USDC using `* 10_000`

That was one of the important Opus review fixes.

### Section 10: gateway routes

Lines:
- `568-920`

This is the actual route layer.

#### `GET /health`
Lines:
- `568-576`

Purpose:
- confirms gateway is live
- shows publisher origin
- shows Solana RPC
- shows recipient wallet

#### `ALL /p/:slug`
Lines:
- `578-669`

This is the most important route in the system.

What it does:
1. read `slug`
2. reject unknown slugs
3. read `address` and `cluster`
4. read `X-API-Key` and `X-Solana-Tx`
5. reject ambiguous auth if both provided
6. require at least one payment path
7. check budget or verify payment
8. fetch upstream wallet data
9. shape response according to slug
10. debit budget or consume payment
11. record usage event
12. return response with billing headers

This route is where:
- API monetization
- budget control
- proxy behavior
- usage metering

all meet.

#### `POST /webhooks/dodo`
Lines:
- `671-694`

Purpose:
- accepts Dodo subscription-style payload
- updates budget
- returns budget state and dev API key

#### Dev inspection routes
Lines:
- `696-720`

Routes:
- `/dev/budgets`
- `/dev/usage-events`
- `/dev/payments`

Purpose:
- debug internal in-memory state

These are very useful during development and demo prep.

#### `POST /api/runs`
Lines:
- `722-843`

This is the main Day 28 feature.

What it does:
1. validate request body
2. require human API key
3. ensure enough budget for 3 paid calls
4. execute planner v0 through `startAgentRun`
5. call 3 tool executors:
   - wallet summary
   - recent activity
   - risk flags
6. debit budget after each tool call
7. record usage event after each tool call
8. return the final run

This route is what transformed the project into:
- “human funds an agent task”
- “agent spends across multiple tools”

#### `GET /api/runs`
Lines:
- `845-851`

Returns all current in-memory runs.

#### `GET /api/runs/:id`
Lines:
- `853-864`

Returns the raw run object.

#### `GET /api/runs/:id/report`
Lines:
- `866-877`

Returns a cleaned report JSON view.

This is a better consumer-facing representation than the raw run object.

#### `GET /demo`
Lines:
- `879-887`

Returns the browser launcher page.

Purpose:
- create a run from browser
- browse recent runs

#### `GET /demo/runs/:id`
Lines:
- `889-903`

Returns the HTML report page.

This is the most showable endpoint for the hackathon right now.

#### `POST /verify/solana-tx`
Lines:
- `905-919`

Debug route for manual Solana payment verification.

---

## `gateway/src/agent-runtime.ts` walkthrough

File:
- [gateway/src/agent-runtime.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/agent-runtime.ts)

This file contains the orchestration logic for agent runs.

### Main function: `startAgentRun`

Lines:
- `34-177`

What it does:
1. create run record
2. mark run started
3. run step 1: wallet summary
4. run step 2: recent activity
5. run step 3: risk flags
6. mark final brief step completed
7. build `resultSummary`
8. build richer `resultArtifact`
9. complete the run
10. if anything fails:
   - mark later steps skipped
   - fail the run

This file is intentionally smaller than `index.ts`.

If you want to understand the “agent brain” first, review this file before coming back to `index.ts`.

Important truth:
- planner is still deterministic
- there is no real LLM planning yet
- the agent workflow is still hardcoded

But it is now:
- multi-step
- paid
- report-producing

which is enough to be meaningful.

---

## `agent/src/index.ts` walkthrough

File:
- [agent/src/index.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/agent/src/index.ts)

This is the in-memory run store and run model.

Key concepts:
- `AgentRunStatus`
- `AgentRunStep`
- `AgentRunRecord`

The most important thing here is the data model for a run.

What a run stores:
- prompt
- target wallet
- current status
- allocated budget
- spent budget
- result summary
- result artifact
- error message
- steps
- timestamps

Helper functions:
- `createRun`
- `updateRunStep`
- `markRunStarted`
- `completeRun`
- `failRun`
- `getRun`
- `listRuns`

This file is worth understanding because it is the cleanest representation of:
- what the agent runtime thinks a run is

---

## `gateway/src/report-surface.ts` walkthrough

File:
- [gateway/src/report-surface.ts](/Users/yashkale/SolanaProjects/agent-budget-billing/gateway/src/report-surface.ts)

This file was extracted tonight as the first step toward splitting `index.ts`.

It contains:
- report view types
- HTML rendering for one report
- HTML rendering for the demo launcher page

### Why this file matters

Without it, the system was still mainly:
- backend JSON
- curl-driven

With it, the project became:
- browser-showable
- easier to demo
- easier to inspect during office

This extraction was a smart first split because:
- it removed presentation concerns from `index.ts`
- without forcing a full refactor right now

---

## Schema walkthrough

File:
- [db/migrations/001_initial_schema.sql](/Users/yashkale/SolanaProjects/agent-budget-billing/db/migrations/001_initial_schema.sql)

Important tables:

### `publishers`
Represents API publishers.

Important fields:
- `slug`
- `origin_url`
- `solana_recipient`
- pricing defaults

### `pricing_rules`
Future pricing engine table.

### `dodo_subscriptions`
Tracks human subscription state from Dodo.

### `api_keys`
Stores human access credentials.

### `user_budgets`
Core budget table for funded users/owners.

### `agent_runs`
Persistence target for the runtime we are currently keeping in memory.

### `x402_payments`
Persistence target for agent payment verification records.

### `settlement_windows`
Future on-chain billing proof batches.

### `usage_events`
The most operationally important table long-term.

Why:
- every paid call should land here
- every settlement window will eventually summarize these

Important truth:
- the schema is stronger than the current runtime
- runtime still needs to catch up to schema via DB persistence

---

## Current real endpoints

### Health / debug
- `GET /health`
- `GET /dev/budgets`
- `GET /dev/usage-events`
- `GET /dev/payments`

### Gateway / monetized tools
- `ALL /p/wallet-summary?address=...&cluster=devnet`
- `ALL /p/recent-activity?address=...&cluster=devnet`
- `ALL /p/risk-flags?address=...&cluster=devnet`

### Dodo
- `POST /webhooks/dodo`

### Agent runtime
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/report`

### Demo browser surfaces
- `GET /demo`
- `GET /demo/runs/:id`

### Solana fallback
- `POST /verify/solana-tx`

---

## What is real vs what is still stubbed

### Real
- human API key budget gating
- per-call debit
- usage event recording
- proxy route
- Dodo-style budget refill flow
- manual Solana fallback verification
- 3 monetized tools
- 3-step paid agent run
- JSON report
- HTML report
- HTML demo launcher

### Stubbed / simplified
- Dodo webhook signature verification
- manual Solana fallback uses SOL lamports, not USDC SPL
- all runtime state is in-memory
- planner is hardcoded
- risk flags are heuristic
- report recommendations are deterministic
- no Postgres persistence yet
- no real on-chain settlement windows yet

---

## Best review order for office

If you want to understand this efficiently during office:

### Pass 1: business understanding
Read:
- this file
- `docs/00_build_log.md`

Goal:
- know what exists
- know what is real vs fake

### Pass 2: agent flow
Read:
- `gateway/src/agent-runtime.ts`
- `agent/src/index.ts`

Goal:
- understand how a run is created and completed

### Pass 3: gateway money logic
Read these sections of `gateway/src/index.ts`:
- config constants
- budget helpers
- usage event recorder
- `/p/:slug`
- `/api/runs`

Goal:
- understand where money is checked and spent

### Pass 4: demo surfaces
Read:
- `gateway/src/report-surface.ts`
- `/demo`
- `/demo/runs/:id`

Goal:
- understand what you can actually present

---

## Questions you should be able to answer after review

If you understand the current state well, you should be able to answer:

1. What is publisher 0?
2. Why do we call port `3000` the upstream?
3. Why does the gateway sit on `8787`?
4. How does a human-funded call get authorized?
5. When do we return `401`, `403`, and `402`?
6. How does a budget get created?
7. When does budget debit happen?
8. What is a usage event?
9. What does the manual Solana fallback verify today?
10. What does `POST /api/runs` actually do?
11. Why are there 3 monetized tools even though we only have one upstream publisher API?
12. What does `/api/runs/:id/report` add over `/api/runs/:id`?
13. What does `/demo` add over curl-based testing?
14. What is still fake / simplified?

If you can answer those, you are in a very strong state.

---

## Where we are when you come back home

When you resume later, the truthful state is:

- Day 27 catch-up is done
- Day 28 is materially underway
- the project now has a credible funded-agent demo spine
- the next commit should likely wait for one Opus review
- `index.ts` is large, but splitting it is not the top priority before understanding and review

Highest-leverage next moves later:
- get Opus review on the current Day 28 chunk
- then either:
  - refactor `index.ts` into route/helper modules
  - or move to the next plan block if review says keep momentum

---

## Final blunt summary

We no longer just have:
- a billing gateway

We now have:
- a funded agent run
- 3 paid tool calls
- budget spend tracking
- usage event trail
- JSON report
- HTML report
- HTML demo launcher

That is a real leap.
