# Settlement Program

This folder contains the Anchor program for the Solana settlement layer used by Agent Budget Billing.

The program is intentionally small.

Its job is not to meter API calls directly. The gateway does that off-chain in Postgres. The program exists to anchor short settlement windows on Solana so committed billing batches become publicly verifiable.

## What The Program Does

The program supports two instructions:

- `init_publisher`
- `commit_window`

### `init_publisher`

Creates a `Publisher` PDA for a logical publisher identity.

It stores:

- `authority`
- `publisher_id`
- `current_window_index`

This is the on-chain identity that is later allowed to commit settlement windows.

### `commit_window`

Creates a `Window` PDA for the next ordered settlement window and stores:

- publisher
- window index
- Merkle root
- previous window hash
- total calls
- total revenue
- committed timestamp

This is the actual on-chain commitment for one batch of usage events.

## Accounts

### `Publisher`

The `Publisher` account stores:

- `authority: Pubkey`
- `publisher_id: [u8; 32]`
- `current_window_index: u64`

Purpose:

- ties authority to a logical publisher
- enforces sequential settlement windows

### `Window`

The `Window` account stores:

- `publisher: Pubkey`
- `window_index: u64`
- `merkle_root: [u8; 32]`
- `prev_window_hash: [u8; 32]`
- `total_calls: u64`
- `total_revenue_usdc: u64`
- `committed_at: i64`

Purpose:

- commits one off-chain billing batch on-chain
- links that batch to earlier committed history

## Why This Exists

The gateway records detailed usage events off-chain because:

- writes are frequent
- queries need to be cheap
- the product needs operational flexibility

But a private database alone still requires trusting the operator.

This program adds the public verification layer:

- the gateway batches usage events into short windows
- computes a Merkle root
- commits that root on-chain
- later, any event can be proven against the committed window

So the chain does not replace Postgres.

It audits committed settlement history from the outside.

## Workspace Layout

Anchor workspace root:

- `/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement`

Program crate:

- `/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement`

Key source files:

- [lib.rs](/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement/src/lib.rs)
- [state.rs](/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement/src/state.rs)
- [error.rs](/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement/src/error.rs)
- [init_publisher.rs](/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement/src/instructions/init_publisher.rs)
- [commit_window.rs](/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement/src/instructions/commit_window.rs)
- [settlement.rs](/Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement/programs/gateway_settlement/tests/settlement.rs)

## Current Devnet Deployment

Current devnet program id:

- `92xJg6zJM8Rh8bPDnpuX1PxSnVJ1dojodsE1dSJqNAHh`

The workspace `Anchor.toml` is already pointed at devnet for this flow.

## Build And Test

From the Anchor workspace root:

```bash
cd /Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement
anchor build
```

Rust tests live in the program crate and cover:

- publisher initialization
- successful window commit
- out-of-order window rejection

If your local `cargo test` uses the wrong toolchain, the explicit working pattern used here was:

```bash
env RUSTC=/Users/yashkale/.rustup/toolchains/1.89.0-aarch64-apple-darwin/bin/rustc \
  /Users/yashkale/.rustup/toolchains/1.89.0-aarch64-apple-darwin/bin/cargo test
```

## Deployment

Successful devnet deploy path used for this repo:

```bash
cd /Users/yashkale/SolanaProjects/agent-budget-billing/program/gateway_settlement
anchor program deploy --provider.cluster devnet --program-name gateway_settlement --no-idl
```

The plain `anchor deploy` flow was fine for the binary itself, but `--no-idl` avoided an IDL upload issue during this build.

## Relationship To The Gateway

The gateway settlement worker:

1. groups usage events into short windows
2. builds Merkle leaves
3. computes the Merkle root
4. derives the `Publisher` and `Window` PDAs
5. calls `commit_window`
6. stores the resulting transaction signature back in Postgres

That is the full off-chain to on-chain settlement loop.
