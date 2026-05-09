use anchor_lang::prelude::*;

#[account]
pub struct Publisher {
    pub authority: Pubkey,
    pub publisher_id: [u8; 32],
    pub current_window_index: u64,
}

impl Publisher {
    pub const SPACE: usize = 32 + 32 + 8;
}

#[account]
pub struct Window {
    pub publisher: Pubkey,
    pub window_index: u64,
    pub merkle_root: [u8; 32],
    pub prev_window_hash: [u8; 32],
    pub total_calls: u64,
    pub total_revenue_usdc: u64,
    pub committed_at: i64,
}

impl Window {
    pub const SPACE: usize = 32 + 8 + 32 + 32 + 8 + 8 + 8;
}
