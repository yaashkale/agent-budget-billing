import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  fetchPreviousCommittedWindow,
  listEventsForWindow,
  listWindowsToCommit,
  markWindowClosedPendingCommit,
  markWindowCommitted,
  recordWindowCommitFailure,
} from "../persistence.js";
import {
  buildMerkleRoot,
  computePrevWindowHash,
  computePublisherIdBytes,
  hashLeaf,
} from "./merkle.js";
import {
  derivePublisherPda,
  deriveWindowPda,
  getAnchorProgram,
  isAnchorEnabled,
} from "./anchor-client.js";

const WORKER_INTERVAL_MS = Number(
  process.env.SETTLEMENT_WORKER_INTERVAL_MS ?? 30_000
);
const PUBLISHER_SLUG = process.env.DEFAULT_PUBLISHER_SLUG ?? "publisher-0";

let running = false;

async function tick() {
  if (running) {
    return;
  }

  running = true;

  try {
    if (!isAnchorEnabled()) {
      return;
    }

    const program = getAnchorProgram();
    const windows = await listWindowsToCommit();

    for (const window of windows) {
      try {
        if (window.status === "open") {
          await markWindowClosedPendingCommit(window.id);
        }

        const events = await listEventsForWindow(window.id);
        const leaves = events.map((event) =>
          hashLeaf({
            eventId: event.eventId,
            publisherId: PUBLISHER_SLUG,
            timestampMs: new Date(event.createdAt).getTime(),
            callerType: event.callerType,
            apiKeyId: event.apiKeyId,
            x402PaymentId: event.x402PaymentId,
            endpointPath: event.endpointPath,
            statusCode: event.statusCode,
            billedUsdcMicros: event.billedUsdcMicros,
          })
        );

        const merkleRoot = buildMerkleRoot(leaves);
        const previousWindow = await fetchPreviousCommittedWindow(
          window.publisherId
        );
        const prevWindowHash = previousWindow?.merkle_root
          ? computePrevWindowHash({
              merkleRoot: Uint8Array.from(previousWindow.merkle_root),
              totalCalls: BigInt(previousWindow.total_calls),
              totalRevenueUsdc: BigInt(
                previousWindow.total_revenue_usdc_micros
              ),
              committedAtUnix: previousWindow.committed_at
                ? Math.floor(
                    new Date(previousWindow.committed_at).getTime() / 1000
                  )
                : 0,
            })
          : new Uint8Array(32);

        const totalCalls = events.length;
        const totalRevenueUsdcMicros = events.reduce(
          (sum, event) => sum + event.billedUsdcMicros,
          0
        );

        const publisherIdBytes = computePublisherIdBytes(PUBLISHER_SLUG);
        const [publisherPda] = derivePublisherPda(publisherIdBytes);
        const [windowPda] = deriveWindowPda(
          publisherPda,
          window.windowIndex
        );

        const signature = await program.methods
          .commitWindow(
            new BN(window.windowIndex.toString()),
            Array.from(merkleRoot) as Array<number>,
            Array.from(prevWindowHash) as Array<number>,
            new BN(totalCalls),
            new BN(totalRevenueUsdcMicros)
          )
          .accountsStrict({
            publisher: publisherPda,
            window: windowPda,
            authority: program.provider.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        await markWindowCommitted({
          windowId: window.id,
          merkleRoot: Buffer.from(merkleRoot),
          prevWindowHash: Buffer.from(prevWindowHash),
          totalCalls,
          totalRevenueUsdcMicros,
          onChainTxSignature: signature,
          onChainWindowPda: windowPda.toBase58(),
        });

        console.log(
          `[settlement] committed window ${window.windowIndex.toString()} for publisher ${window.publisherId} -> ${signature}`
        );
      } catch (thrownObject) {
        const error =
          thrownObject instanceof Error
            ? thrownObject
            : new Error(String(thrownObject));

        await recordWindowCommitFailure({
          windowId: window.id,
          error: error.message,
        });

        console.error(
          `[settlement] commit failed for window ${window.id}: ${error.message}`
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startSettlementWorker() {
  if (!isAnchorEnabled()) {
    console.warn("[settlement] ANCHOR_PROGRAM_ID unset - worker disabled");
    return;
  }

  setInterval(() => {
    tick().catch((thrownObject) => {
      const error =
        thrownObject instanceof Error
          ? thrownObject
          : new Error(String(thrownObject));
      console.error("[settlement] tick error", error);
    });
  }, WORKER_INTERVAL_MS);

  console.log(
    `[settlement] worker started (interval=${WORKER_INTERVAL_MS}ms)`
  );
}
