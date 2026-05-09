use anchor_lang::prelude::*;

#[error_code]
pub enum GatewayError {
    #[msg("Signer is not the publisher authority")]
    Unauthorized,
    #[msg("Window index does not match the publisher's current window index")]
    WindowIndexMismatch,
    #[msg("Window index overflow")]
    WindowOverflow,
}
