# Agent Budget Billing

Agent Budget Billing is a paid API gateway for humans and agents with:

- prepaid budgets funded through Dodo
- metered tool usage
- guided AI research workflows
- Solana settlement commitments for public auditability

It was built for the Dodo Payments x Solana hackathon.

## The Problem

Crypto research is fragmented.

If someone wants to investigate a wallet, a token, or a risk signal, they usually bounce across multiple tools, pay in disconnected ways, and still have no clean billing or settlement trail for agent-driven usage.

This project turns that into one system:

- fund a budget
- spend it on paid research calls
- let an agent run a multi-step workflow
- record every charged call
- anchor settlement windows on Solana

## What The Product Does

### Paid API tools

- `GET /p/wallet-summary`
- `GET /p/recent-activity`
- `GET /p/risk-flags`
- `GET /p/holder-distribution`

### Paid agent workflow

The current guided workflow performs 5 billed steps:

1. `wallet_summary`
2. `recent_activity`
3. `holder_distribution`
4. `risk_flags`
5. `llm_analysis`

That produces a final brief with:

- summary
- executive summary
- findings
- recommendation
- risk level

This is not pretending to be arbitrary open-ended tool planning yet. It is a guided paid research workflow with real billing and real synthesis.

## Why It’s Interesting

Most projects stop at one of these:

- payments
- AI
- analytics
- on-chain proof

This repo combines all four:

- Dodo-backed budget funding
- per-call billing for humans and agents
- OpenAI-powered synthesis
- Merkle-rooted settlement commitments on Solana

## Architecture

This is intentionally a hybrid system.

### Off-chain

Postgres is the operational ledger.

It handles:

- budgets
- API keys
- usage events
- agent runs
- settlement window staging

### On-chain

Solana is the public integrity and settlement layer.

The Anchor program stores settlement windows so committed billing batches become externally verifiable.

The key idea is:

- detailed events live off-chain for speed and product usability
- short windows of those events are Merkle-committed on-chain

So the chain does not replace the database.

It audits committed history from the outside.

## Current Status

Working today:

- Postgres-backed API key lookup
- Postgres-backed budget persistence
- atomic budget debits
- Postgres-backed `usage_events`
- Dodo webhook-driven budget refresh
- OpenAI-backed `llm-analysis` with deterministic fallback
- Helius-backed holder-distribution with clean large-mint handling
- Anchor settlement program with:
  - `init_publisher`
  - `commit_window`
- Rust tests for the settlement program
- settlement worker that:
  - groups usage events into windows
  - builds Merkle roots
  - commits windows on Solana devnet

Known gaps:

- manual `X-Solana-Tx` / `x402_payments` persistence is still incomplete
- `agent_runs` persistence is still in-memory
- webhook signature verification is still a dev stub
- proof endpoint is not exposed yet

## Repo Layout

- `gateway/`
  - paid gateway, billing logic, settlement worker
- `program/`
  - Anchor workspace and settlement program
- `db/`
  - schema and migrations
- `agent/`
  - run/report surfaces
- `dashboard/`
  - demo and operator-facing UI work

## Key Flows

### Budget flow

1. user gets funded through Dodo
2. gateway associates budget with API-key access
3. each paid call decrements budget
4. insufficient balance returns `402`

### Agent flow

1. user submits a research request
2. gateway runs the paid workflow
3. each step is metered
4. final brief is returned

### Settlement flow

1. successful paid calls create `usage_events`
2. events are grouped into short settlement windows
3. worker computes Merkle leaves and a Merkle root
4. worker commits that window on Solana
5. the batch becomes publicly auditable

## Why Solana

This project uses Solana because the economics fit the product:

- cheap enough for frequent settlement commits
- fast enough for developer-friendly iteration
- natural fit for stablecoin-denominated payment and audit flows

The point is not “put every API call on-chain.”

The point is:

- keep operations practical off-chain
- keep committed settlement verifiable on-chain

## Local Development

Top-level workspace scripts:

```bash
npm run dev:gateway
npm run dev:dashboard
npm run dev:agent
```

Useful environment variables:

```bash
DATABASE_URL=
PUBLISHER_ORIGIN=
OPENAI_API_KEY=
OPENAI_MODEL=
HELIUS_API_KEY=
ANCHOR_PROGRAM_ID=
ANCHOR_CLUSTER_URL=
ANCHOR_PAYER_KEYPAIR_PATH=
```

More package-specific details:

- [`gateway/README.md`](gateway/README.md)
- [`program/README.md`](program/README.md)
- [`db/README.md`](db/README.md)

## Demo Story

The intended demo loop is:

1. budget gets funded through Dodo
2. a human or agent spends that budget on research calls
3. the gateway meters each call
4. the agent returns a research brief
5. the billed batch is committed on Solana
6. the settlement history becomes auditable

## Honest Framing

This repo is not claiming trustless ingestion from the first byte.

It is claiming something more practical:

- centralized operations for speed and usability
- decentralized commitments for settlement integrity

That tradeoff is the whole design.
