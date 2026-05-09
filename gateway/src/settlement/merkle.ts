import { keccak_256 } from "@noble/hashes/sha3";

export type UsageEventLeafInput = {
  eventId: string;
  publisherId: string;
  timestampMs: number;
  callerType: "human" | "agent";
  apiKeyId: string | null;
  x402PaymentId: string | null;
  endpointPath: string;
  statusCode: number;
  billedUsdcMicros: number;
};

export type MerkleProofStep = {
  position: "left" | "right";
  sibling: Uint8Array;
};

const textEncoder = new TextEncoder();
const ZERO_16 = new Uint8Array(16);
const ZERO_32 = new Uint8Array(32);

function concatBytes(...parts: Array<Uint8Array>) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function parseUuidToBytes16(uuid: string | null) {
  if (!uuid) {
    return ZERO_16;
  }

  const normalized = uuid.replaceAll("-", "");

  if (normalized.length !== 32) {
    throw new Error(`Invalid UUID length for ${uuid}`);
  }

  const output = new Uint8Array(16);

  for (let index = 0; index < 16; index += 1) {
    output[index] = Number.parseInt(
      normalized.slice(index * 2, index * 2 + 2),
      16
    );
  }

  return output;
}

function hashStringToBytes32(input: string) {
  return keccak_256(textEncoder.encode(input));
}

function u64BigEndian(value: number | bigint) {
  const output = new Uint8Array(8);
  const view = new DataView(output.buffer);
  view.setBigUint64(0, BigInt(value), false);
  return output;
}

function u16BigEndian(value: number) {
  const output = new Uint8Array(2);
  const view = new DataView(output.buffer);
  view.setUint16(0, value, false);
  return output;
}

function hashPath(endpointPath: string) {
  return keccak_256(textEncoder.encode(endpointPath));
}

function hashPair(left: Uint8Array, right: Uint8Array) {
  return keccak_256(concatBytes(left, right));
}

export function hashLeaf(input: UsageEventLeafInput): Uint8Array {
  return keccak_256(
    concatBytes(
      parseUuidToBytes16(input.eventId),
      hashStringToBytes32(input.publisherId),
      u64BigEndian(input.timestampMs),
      new Uint8Array([input.callerType === "agent" ? 1 : 0]),
      parseUuidToBytes16(input.apiKeyId),
      parseUuidToBytes16(input.x402PaymentId),
      hashPath(input.endpointPath),
      u16BigEndian(input.statusCode),
      u64BigEndian(input.billedUsdcMicros)
    )
  );
}

export function buildMerkleRoot(leaves: Array<Uint8Array>): Uint8Array {
  if (leaves.length === 0) {
    return ZERO_32;
  }

  let layer = leaves.slice();

  while (layer.length > 1) {
    const nextLayer: Array<Uint8Array> = [];

    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right =
        index + 1 < layer.length ? layer[index + 1] : layer[index];
      nextLayer.push(hashPair(left, right));
    }

    layer = nextLayer;
  }

  return layer[0];
}

export function buildMerkleProof(
  leaves: Array<Uint8Array>,
  index: number
): Array<MerkleProofStep> {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`Leaf index ${index} is out of bounds`);
  }

  const proof: Array<MerkleProofStep> = [];
  let layer = leaves.slice();
  let layerIndex = index;

  while (layer.length > 1) {
    const isRightNode = layerIndex % 2 === 1;
    const siblingIndex = isRightNode
      ? layerIndex - 1
      : Math.min(layerIndex + 1, layer.length - 1);

    proof.push({
      position: isRightNode ? "left" : "right",
      sibling: layer[siblingIndex],
    });

    const nextLayer: Array<Uint8Array> = [];

    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right =
        index + 1 < layer.length ? layer[index + 1] : layer[index];
      nextLayer.push(hashPair(left, right));
    }

    layer = nextLayer;
    layerIndex = Math.floor(layerIndex / 2);
  }

  return proof;
}

export function verifyMerkleProof(
  leaf: Uint8Array,
  proof: Array<MerkleProofStep>,
  expectedRoot: Uint8Array
) {
  let computed = leaf;

  for (const step of proof) {
    computed =
      step.position === "left"
        ? hashPair(step.sibling, computed)
        : hashPair(computed, step.sibling);
  }

  return Buffer.from(computed).equals(Buffer.from(expectedRoot));
}

export function computePublisherIdBytes(publisherSlug: string) {
  return hashStringToBytes32(publisherSlug);
}

export function computePrevWindowHash(previousWindow: {
  merkleRoot: Uint8Array;
  totalCalls: number | bigint;
  totalRevenueUsdc: number | bigint;
  committedAtUnix: number | bigint;
}) {
  return keccak_256(
    concatBytes(
      previousWindow.merkleRoot,
      u64BigEndian(previousWindow.totalCalls),
      u64BigEndian(previousWindow.totalRevenueUsdc),
      u64BigEndian(previousWindow.committedAtUnix)
    )
  );
}
