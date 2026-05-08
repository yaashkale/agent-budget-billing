const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? null;

export type HolderDistributionResponse = {
  address: string;
  shortAddress: string;
  cluster: string;
  source: "mock" | "helius";
  holderCount: number | null;
  sampledHolderAccounts: number;
  top10Percentage: number;
  top20Percentage: number;
  concentrationScore: "low" | "medium" | "high";
  topHolders: Array<{
    rank: number;
    ownerAddress: string | null;
    tokenAccountAddress: string;
    amount: number;
    percentage: number;
  }>;
  summary: string;
  limitations: string[];
};

function shortenAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function roundPercentage(value: number) {
  return Number(value.toFixed(2));
}

function computeConcentrationScore(top10Percentage: number) {
  if (top10Percentage >= 70) {
    return "high";
  }

  if (top10Percentage >= 35) {
    return "medium";
  }

  return "low";
}

function buildMockDistribution(input: {
  address: string;
  cluster: string;
}): HolderDistributionResponse {
  const seed = [...input.address].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const top10Percentage = roundPercentage(28 + (seed % 31));
  const top20Percentage = roundPercentage(
    Math.min(96, top10Percentage + 18 + (seed % 17))
  );
  const shortAddress = shortenAddress(input.address);
  const topHolders = Array.from({ length: 5 }, (_, index) => {
    const rank = index + 1;
    const percentage = roundPercentage(
      Math.max(2, top10Percentage / (rank + 1.75))
    );

    return {
      rank,
      ownerAddress: `mock-owner-${rank}-${shortAddress}`,
      tokenAccountAddress: `mock-token-account-${rank}-${shortAddress}`,
      amount: Number((percentage * 12_500).toFixed(2)),
      percentage,
    };
  });

  const concentrationScore = computeConcentrationScore(top10Percentage);

  return {
    address: input.address,
    shortAddress,
    cluster: input.cluster,
    source: "mock",
    holderCount: 125 + (seed % 2000),
    sampledHolderAccounts: 20,
    top10Percentage,
    top20Percentage,
    concentrationScore,
    topHolders,
    summary:
      concentrationScore === "high"
        ? `Mock holder scan for ${shortAddress} suggests concentrated ownership: the top 10 holders control about ${top10Percentage}% of observed supply.`
        : `Mock holder scan for ${shortAddress} suggests more distributed ownership: the top 10 holders control about ${top10Percentage}% of observed supply.`,
    limitations: [
      "HELIUS_API_KEY is not configured, so this is deterministic mock data.",
      "Percentages are scaffold values for local development only.",
    ],
  };
}

function getHeliusRpcUrl(cluster: string) {
  if (!HELIUS_API_KEY) {
    return null;
  }

  return cluster === "mainnet-beta"
    ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
    : `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
}

async function callHeliusRpc<T>(input: {
  cluster: string;
  method: string;
  params: unknown[];
}) {
  const rpcUrl = getHeliusRpcUrl(input.cluster);

  if (!rpcUrl) {
    return null;
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: input.method,
      method: input.method,
      params: input.params,
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Helius RPC ${input.method} failed: ${response.status} ${body}`);
  }

  const payload = JSON.parse(body) as {
    result?: T;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(
      `Helius RPC ${input.method} error: ${payload.error.message ?? "unknown error"}`
    );
  }

  return payload.result ?? null;
}

export async function fetchHolderDistribution(input: {
  address: string;
  cluster: string;
}): Promise<HolderDistributionResponse> {
  if (!HELIUS_API_KEY) {
    return buildMockDistribution(input);
  }

  const largestAccounts = await callHeliusRpc<{
    value: Array<{
      address: string;
      amount: string;
      decimals: number;
      uiAmount: number | null;
      uiAmountString: string;
    }>;
  }>({
    cluster: input.cluster,
    method: "getTokenLargestAccounts",
    params: [input.address],
  });

  const supply = await callHeliusRpc<{
    value: {
      amount: string;
      decimals: number;
      uiAmount: number | null;
      uiAmountString: string;
    };
  }>({
    cluster: input.cluster,
    method: "getTokenSupply",
    params: [input.address],
  });

  if (!largestAccounts?.value?.length || !supply?.value) {
    throw new Error(
      `No holder concentration data available for ${input.address}. This tool expects a token mint address.`
    );
  }

  const topAccounts = largestAccounts.value.slice(0, 20);
  const parsedAccounts = await callHeliusRpc<{
    value: Array<
      | {
          data?: {
            parsed?: {
              info?: {
                owner?: string;
              };
            };
          };
        }
      | null
    >;
  }>({
    cluster: input.cluster,
    method: "getMultipleAccounts",
    params: [topAccounts.map((account) => account.address), { encoding: "jsonParsed" }],
  });

  const totalSupply =
    supply.value.uiAmount ?? Number(supply.value.amount) / 10 ** supply.value.decimals;

  const topHolders = topAccounts.slice(0, 10).map((account, index) => {
    const amount =
      account.uiAmount ?? Number(account.amount) / 10 ** account.decimals;
    const percentage = totalSupply > 0 ? roundPercentage((amount / totalSupply) * 100) : 0;

    return {
      rank: index + 1,
      ownerAddress:
        parsedAccounts?.value?.[index]?.data?.parsed?.info?.owner ?? null,
      tokenAccountAddress: account.address,
      amount: Number(amount.toFixed(6)),
      percentage,
    };
  });

  const top10Percentage = roundPercentage(
    topHolders.reduce((sum, holder) => sum + holder.percentage, 0)
  );
  const top20Percentage = roundPercentage(
    topAccounts.reduce((sum, account) => {
      const amount =
        account.uiAmount ?? Number(account.amount) / 10 ** account.decimals;
      return sum + (totalSupply > 0 ? (amount / totalSupply) * 100 : 0);
    }, 0)
  );
  const concentrationScore = computeConcentrationScore(top10Percentage);
  const shortAddress = shortenAddress(input.address);

  return {
    address: input.address,
    shortAddress,
    cluster: input.cluster,
    source: "helius",
    holderCount: null,
    sampledHolderAccounts: topAccounts.length,
    top10Percentage,
    top20Percentage,
    concentrationScore,
    topHolders,
    summary:
      concentrationScore === "high"
        ? `Holder concentration for ${shortAddress} looks high: the top 10 token accounts control about ${top10Percentage}% of total supply.`
        : `Holder concentration for ${shortAddress} looks ${concentrationScore}: the top 10 token accounts control about ${top10Percentage}% of total supply.`,
    limitations: [
      "This view samples the largest token accounts returned by RPC, not every holder wallet.",
      "If token accounts are custodial or exchange-owned, concentration may overstate single-entity ownership.",
    ],
  };
}
