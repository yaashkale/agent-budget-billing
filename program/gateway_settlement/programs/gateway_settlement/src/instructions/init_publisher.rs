use crate::state::Publisher;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(publisher_id: [u8; 32])]
pub struct InitPublisher<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Publisher::SPACE,
        seeds = [b"publisher", publisher_id.as_ref()],
        bump,
    )]
    pub publisher: Account<'info, Publisher>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitPublisher<'info> {
    fn populate_publisher(&mut self, publisher_id: [u8; 32]) -> Result<()> {
        self.publisher.set_inner(Publisher {
            authority: self.authority.key(),
            publisher_id,
            current_window_index: 0,
        });

        Ok(())
    }
}

pub fn handler(ctx: Context<InitPublisher>, publisher_id: [u8; 32]) -> Result<()> {
    ctx.accounts.populate_publisher(publisher_id)?;
    Ok(())
}
