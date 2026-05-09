pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::{
    commit_window::__client_accounts_commit_window,
    init_publisher::__client_accounts_init_publisher,
};
pub use instructions::{commit_window::CommitWindow, init_publisher::InitPublisher};

declare_id!("92xJg6zJM8Rh8bPDnpuX1PxSnVJ1dojodsE1dSJqNAHh");

#[program]
pub mod gateway_settlement {
    use super::*;

    pub fn init_publisher(
        ctx: Context<InitPublisher>,
        publisher_id: [u8; 32],
    ) -> Result<()> {
        instructions::init_publisher::handler(ctx, publisher_id)
    }

    pub fn commit_window(
        ctx: Context<CommitWindow>,
        window_index: u64,
        merkle_root: [u8; 32],
        prev_window_hash: [u8; 32],
        total_calls: u64,
        total_revenue_usdc: u64,
    ) -> Result<()> {
        instructions::commit_window::handler(
            ctx,
            window_index,
            merkle_root,
            prev_window_hash,
            total_calls,
            total_revenue_usdc,
        )
    }
}
