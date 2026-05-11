import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import idl from "../program/gateway_settlement.json" with { type: "json" };
import type { GatewaySettlement } from "../program/gateway_settlement.js";

const PROGRAM_ID = new PublicKey(
  process.env.ANCHOR_PROGRAM_ID ?? "11111111111111111111111111111111"
);
const CLUSTER_URL =
  process.env.ANCHOR_CLUSTER_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.ANCHOR_PAYER_KEYPAIR_PATH ??
  `${homedir()}/.config/solana/id.json`;
const KEYPAIR_B64 = process.env.ANCHOR_PAYER_KEYPAIR_B64 ?? null;
const KEYPAIR_JSON = process.env.ANCHOR_PAYER_KEYPAIR_JSON ?? null;

let cachedProgram: anchor.Program<GatewaySettlement> | null = null;

function loadPayer() {
  if (KEYPAIR_B64) {
    const decoded = Buffer.from(KEYPAIR_B64, "base64").toString("utf8");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decoded) as Array<number>));
  }

  if (KEYPAIR_JSON) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(KEYPAIR_JSON) as Array<number>)
    );
  }

  const raw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")) as Array<number>;
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function isAnchorEnabled() {
  return Boolean(process.env.ANCHOR_PROGRAM_ID);
}

export function getAnchorProgram() {
  if (cachedProgram) {
    return cachedProgram;
  }

  const payer = loadPayer();
  const connection = new Connection(CLUSTER_URL, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed" }
  );

  anchor.setProvider(provider);

  cachedProgram = new anchor.Program<GatewaySettlement>(
    idl as GatewaySettlement,
    provider
  );

  return cachedProgram;
}

export function derivePublisherPda(publisherIdBytes: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("publisher"), Buffer.from(publisherIdBytes)],
    PROGRAM_ID
  );
}

export function deriveWindowPda(
  publisherPda: PublicKey,
  windowIndex: bigint
) {
  const windowIndexBuffer = Buffer.alloc(8);
  windowIndexBuffer.writeBigUInt64LE(windowIndex);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("window"), publisherPda.toBuffer(), windowIndexBuffer],
    PROGRAM_ID
  );
}
