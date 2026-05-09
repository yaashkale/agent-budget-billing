import {
  buildMerkleProof,
  buildMerkleRoot,
  hashLeaf,
  verifyMerkleProof,
} from "./merkle.js";

const leaves = Array.from({ length: 5 }, (_, index) =>
  hashLeaf({
    eventId: `00000000-0000-0000-0000-00000000000${index}`,
    publisherId: "publisher-0",
    timestampMs: 1_700_000_000_000 + index,
    callerType: "agent",
    apiKeyId: null,
    x402PaymentId: null,
    endpointPath: "/p/wallet-summary",
    statusCode: 200,
    billedUsdcMicros: 50_000,
  })
);

const root = buildMerkleRoot(leaves);
const proof = buildMerkleProof(leaves, 2);
const valid = verifyMerkleProof(leaves[2], proof, root);

console.log("Root:", Buffer.from(root).toString("hex"));
console.log("Proof valid:", valid);

if (!valid) {
  process.exit(1);
}
