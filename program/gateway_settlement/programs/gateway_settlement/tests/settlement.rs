use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::{AccountMeta, Instruction},
    AccountDeserialize,
};
use gateway_settlement::{
    state::{Publisher, Window},
    ID,
};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;

const INIT_PUBLISHER_DISCRIMINATOR: [u8; 8] = [101, 102, 35, 176, 210, 160, 28, 154];
const COMMIT_WINDOW_DISCRIMINATOR: [u8; 8] = [212, 136, 159, 180, 113, 80, 194, 103];

fn read_program_bytes() -> Vec<u8> {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("../../target/deploy/gateway_settlement.so");
    std::fs::read(path).expect("expected anchor build artifact at ../../target/deploy/gateway_settlement.so")
}

fn setup_test_context() -> (LiteSVM, Keypair) {
    let authority = Keypair::new();
    let mut svm = LiteSVM::new().with_sysvars();
    svm.add_program(ID, &read_program_bytes())
        .expect("failed to load gateway_settlement program");
    svm.airdrop(&authority.pubkey(), 10_000_000_000)
        .expect("failed to fund authority");
    (svm, authority)
}

fn find_publisher_address(publisher_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"publisher", publisher_id.as_ref()], &ID).0
}

fn find_window_address(publisher: &Pubkey, window_index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"window", publisher.as_ref(), &window_index.to_le_bytes()],
        &ID,
    )
    .0
}

fn encode_init_publisher_data(publisher_id: [u8; 32]) -> Vec<u8> {
    let mut data = INIT_PUBLISHER_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&publisher_id);
    data
}

fn encode_commit_window_data(
    window_index: u64,
    merkle_root: [u8; 32],
    prev_window_hash: [u8; 32],
    total_calls: u64,
    total_revenue_usdc: u64,
) -> Vec<u8> {
    let mut data = COMMIT_WINDOW_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&window_index.to_le_bytes());
    data.extend_from_slice(&merkle_root);
    data.extend_from_slice(&prev_window_hash);
    data.extend_from_slice(&total_calls.to_le_bytes());
    data.extend_from_slice(&total_revenue_usdc.to_le_bytes());
    data
}

fn init_publisher_instruction(authority: Pubkey, publisher_id: [u8; 32]) -> Instruction {
    let publisher = find_publisher_address(&publisher_id);

    Instruction {
        program_id: ID,
        accounts: vec![
            AccountMeta::new(publisher, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
        ],
        data: encode_init_publisher_data(publisher_id),
    }
}

fn commit_window_instruction(
    authority: Pubkey,
    publisher_id: [u8; 32],
    window_index: u64,
    merkle_root: [u8; 32],
    prev_window_hash: [u8; 32],
    total_calls: u64,
    total_revenue_usdc: u64,
) -> Instruction {
    let publisher = find_publisher_address(&publisher_id);
    let window = find_window_address(&publisher, window_index);

    Instruction {
        program_id: ID,
        accounts: vec![
            AccountMeta::new(publisher, false),
            AccountMeta::new(window, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
        ],
        data: encode_commit_window_data(
            window_index,
            merkle_root,
            prev_window_hash,
            total_calls,
            total_revenue_usdc,
        ),
    }
}

fn read_publisher(svm: &mut LiteSVM, publisher: &Pubkey) -> Publisher {
    let account = svm
        .get_account(publisher)
        .expect("publisher account should exist");
    let mut data = account.data.as_slice();
    Publisher::try_deserialize(&mut data).expect("failed to deserialize publisher")
}

fn read_window(svm: &mut LiteSVM, window: &Pubkey) -> Window {
    let account = svm.get_account(window).expect("window account should exist");
    let mut data = account.data.as_slice();
    Window::try_deserialize(&mut data).expect("failed to deserialize window")
}

#[test]
fn init_publisher_initializes_expected_state() {
    let (mut svm, authority) = setup_test_context();
    let publisher_id = [7u8; 32];
    let publisher = find_publisher_address(&publisher_id);

    let transaction = Transaction::new_signed_with_payer(
        &[init_publisher_instruction(authority.pubkey(), publisher_id)],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    svm.send_transaction(transaction)
        .expect("init_publisher should succeed");

    let publisher_state = read_publisher(&mut svm, &publisher);
    assert_eq!(publisher_state.authority, authority.pubkey());
    assert_eq!(publisher_state.publisher_id, publisher_id);
    assert_eq!(publisher_state.current_window_index, 0);
}

#[test]
fn commit_window_persists_window_and_advances_index() {
    let (mut svm, authority) = setup_test_context();
    let publisher_id = [9u8; 32];
    let publisher = find_publisher_address(&publisher_id);
    let merkle_root = [3u8; 32];
    let prev_window_hash = [4u8; 32];
    let total_calls = 5;
    let total_revenue_usdc = 250_000;
    let expected_timestamp = 1_700_000_000;

    let init_transaction = Transaction::new_signed_with_payer(
        &[init_publisher_instruction(authority.pubkey(), publisher_id)],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    svm.send_transaction(init_transaction)
        .expect("init_publisher should succeed");

    let mut clock = svm.get_sysvar::<anchor_lang::solana_program::clock::Clock>();
    clock.unix_timestamp = expected_timestamp;
    svm.set_sysvar(&clock);

    let commit_transaction = Transaction::new_signed_with_payer(
        &[commit_window_instruction(
            authority.pubkey(),
            publisher_id,
            0,
            merkle_root,
            prev_window_hash,
            total_calls,
            total_revenue_usdc,
        )],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    svm.send_transaction(commit_transaction)
        .expect("commit_window should succeed");

    let publisher_state = read_publisher(&mut svm, &publisher);
    let window = find_window_address(&publisher, 0);
    let window_state = read_window(&mut svm, &window);

    assert_eq!(publisher_state.current_window_index, 1);
    assert_eq!(window_state.publisher, publisher);
    assert_eq!(window_state.window_index, 0);
    assert_eq!(window_state.merkle_root, merkle_root);
    assert_eq!(window_state.prev_window_hash, prev_window_hash);
    assert_eq!(window_state.total_calls, total_calls);
    assert_eq!(window_state.total_revenue_usdc, total_revenue_usdc);
    assert_eq!(window_state.committed_at, expected_timestamp);
}

#[test]
fn commit_window_rejects_out_of_order_index() {
    let (mut svm, authority) = setup_test_context();
    let publisher_id = [11u8; 32];
    let publisher = find_publisher_address(&publisher_id);
    let rejected_window = find_window_address(&publisher, 1);

    let init_transaction = Transaction::new_signed_with_payer(
        &[init_publisher_instruction(authority.pubkey(), publisher_id)],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    svm.send_transaction(init_transaction)
        .expect("init_publisher should succeed");

    let commit_transaction = Transaction::new_signed_with_payer(
        &[commit_window_instruction(
            authority.pubkey(),
            publisher_id,
            1,
            [8u8; 32],
            [9u8; 32],
            2,
            100_000,
        )],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    assert!(svm.send_transaction(commit_transaction).is_err());
    assert!(svm.get_account(&rejected_window).is_none());

    let publisher_state = read_publisher(&mut svm, &publisher);
    assert_eq!(publisher_state.current_window_index, 0);
}
