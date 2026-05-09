use crate::{
    error::GatewayError,
    state::{Publisher, Window},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(window_index: u64)]
pub struct CommitWindow<'info> {
    #[account(
        mut,
        seeds = [b"publisher", publisher.publisher_id.as_ref()],
        bump,
    )]
    pub publisher: Account<'info, Publisher>,

    #[account(
        init,
        payer = authority,
        space = 8 + Window::SPACE,
        seeds = [
            b"window",
            publisher.key().as_ref(),
            &window_index.to_le_bytes(),
        ],
        bump,
    )]
    pub window: Account<'info, Window>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CommitWindow<'info> {
    fn validate_commit(&self, window_index: u64) -> Result<()> {
        require_keys_eq!(
            self.publisher.authority,
            self.authority.key(),
            GatewayError::Unauthorized
        );
        require_eq!(
            window_index,
            self.publisher.current_window_index,
            GatewayError::WindowIndexMismatch
        );

        Ok(())
    }

    fn populate_window(
        &mut self,
        window_index: u64,
        merkle_root: [u8; 32],
        prev_window_hash: [u8; 32],
        total_calls: u64,
        total_revenue_usdc: u64,
    ) -> Result<()> {
        self.window.set_inner(Window {
            publisher: self.publisher.key(),
            window_index,
            merkle_root,
            prev_window_hash,
            total_calls,
            total_revenue_usdc,
            committed_at: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    fn advance_publisher_window_index(&mut self, window_index: u64) -> Result<()> {
        self.publisher.current_window_index = window_index
            .checked_add(1)
            .ok_or(GatewayError::WindowOverflow)?;

        Ok(())
    }
}

pub fn handler(
    ctx: Context<CommitWindow>,
    window_index: u64,
    merkle_root: [u8; 32],
    prev_window_hash: [u8; 32],
    total_calls: u64,
    total_revenue_usdc: u64,
) -> Result<()> {
    ctx.accounts.validate_commit(window_index)?;
    ctx.accounts.populate_window(
        window_index,
        merkle_root,
        prev_window_hash,
        total_calls,
        total_revenue_usdc,
    )?;
    ctx.accounts.advance_publisher_window_index(window_index)?;

    Ok(())
}
