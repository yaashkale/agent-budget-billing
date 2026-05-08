// Current scope: gateway runtime with optional DB-backed budgets and API-key lookup.
// Multi-publisher routing, USDC SPL parsing, and full webhook verification still land later.

import { serve } from "@hono/node-server";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import {
  fetchAgentRun,
  fetchAgentRuns,
  startAgentRun,
} from "./agent-runtime.js";
import {
  debitBudgetInDatabase,
  getBudgetByApiKeyFromDatabase,
  initializeBudgetPersistence,
  isDatabaseEnabled,
  listBudgetsFromDatabase,
  listUsageEventsFromDatabase,
  type BudgetRecord,
  type DodoSubscriptionPayload,
  recordUsageEventInDatabase,
  type UsageEventRecord,
  upsertBudgetFromDodoInDatabase,
} from "./persistence.js";
import {
  renderDemoHomeHtml,
  renderRunReportHtml,
} from "./report-surface.js";
import {
  fetchHolderDistribution,
  normalizeHolderDistributionError,
  type HolderDistributionResponse,
} from "./publishers/holder-distribution.js";
import { generateLlmAnalysis } from "./publishers/llm-analysis.js";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLISHER_ORIGIN =
  process.env.PUBLISHER_ORIGIN ?? "http://localhost:3000";
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const DEV_API_KEY = process.env.DEV_API_KEY ?? "dev-human-key";
const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET;
const DEFAULT_BUDGET_REFILL_USDC_MICROS = Number(
  process.env.DEFAULT_BUDGET_REFILL_USDC_MICROS ?? 50_000_000
);
const WALLET_SUMMARY_CALL_COST_USDC_MICROS = Number(
  process.env.WALLET_SUMMARY_CALL_COST_USDC_MICROS ?? 50_000
);
const DEV_SOLANA_RECIPIENT =
  process.env.DEV_SOLANA_RECIPIENT ??
  "818knEVSxm1R36WYPRjKBtzwa1PjaQNf412cZK2HE38L";
const WALLET_SUMMARY_CALL_COST_LAMPORTS = Number(
  process.env.WALLET_SUMMARY_CALL_COST_LAMPORTS ??
    Math.max(1, Math.floor(WALLET_SUMMARY_CALL_COST_USDC_MICROS / 10_000))
);

const app = new Hono();
const solanaConnection = new Connection(SOLANA_RPC_URL, "confirmed");

type VerifiedPaymentRecord = {
  paymentId: string;
  txSignature: string;
  payerAddress: string;
  recipientAddress: string;
  amountLamports: number;
  verificationMethod: "manual";
  verificationStatus: "verified";
  consumedAt: string | null;
  verifiedAt: string;
};

type WalletSummaryApiResponse = {
  address: string;
  shortAddress: string;
  cluster: string;
  explorerUrl: string;
  solBalance: number;
  recentSignatureCount: number;
  recentSignatures: Array<{
    signature: string;
    blockTime: number | null;
    explorerUrl: string | null;
  }>;
  summary: string;
};

type PublisherToolResponse =
  | WalletSummaryApiResponse
  | HolderDistributionResponse
  | Record<string, unknown>;

function formatUsdMicros(usdcMicros: number) {
  return `$${(usdcMicros / 1_000_000).toFixed(2)}`;
}

function formatRunReport(run: ReturnType<typeof fetchAgentRun>) {
  if (!run) {
    return null;
  }

  const artifact = run.resultArtifact;
  const reportMarkdown = artifact
    ? [
        `# ${artifact.headline}`,
        "",
        `**Prompt**: ${run.prompt}`,
        `**Target wallet**: ${run.targetAddress}`,
        `**Status**: ${run.status}`,
        `**Risk level**: ${artifact.riskLevel}`,
        "",
        "## Executive Summary",
        artifact.executiveSummary,
        "",
        "## Findings",
        ...artifact.findings.map((finding) => `- ${finding}`),
        "",
        "## Spend",
        `- Allocated: ${formatUsdMicros(artifact.spendSummary.allocatedUsdcMicros)}`,
        `- Spent: ${formatUsdMicros(artifact.spendSummary.spentUsdcMicros)}`,
        `- Remaining: ${formatUsdMicros(artifact.spendSummary.remainingUsdcMicros)}`,
        `- Paid tool calls: ${artifact.spendSummary.paidToolCalls}`,
        "",
        "## Sources",
        ...artifact.sources.map(
          (source) =>
            `- ${source.tool} via \`${source.endpointPath}\`: ${source.description}`
        ),
        "",
        "## Recommendation",
        artifact.recommendation,
      ].join("\n")
    : null;

  return {
    runId: run.runId,
    status: run.status,
    headline: artifact?.headline ?? null,
    riskLevel: artifact?.riskLevel ?? null,
    executiveSummary: artifact?.executiveSummary ?? null,
    findings: artifact?.findings ?? [],
    recommendation: artifact?.recommendation ?? null,
    spendSummary: artifact?.spendSummary ?? null,
    sources: artifact?.sources ?? [],
    markdown: reportMarkdown,
  };
}

function formatRunListForDemo() {
  return fetchAgentRuns()
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((run) => ({
      runId: run.runId,
      prompt: run.prompt,
      targetAddress: run.targetAddress,
      status: run.status,
      riskLevel: run.resultArtifact?.riskLevel ?? null,
      spentUsdcMicros: run.budgetSpentUsdcMicros,
      createdAt: run.createdAt,
    }));
}

const budgetsById = new Map<string, BudgetRecord>();
const budgetIdsBySubscription = new Map<string, string>();
const budgetIdsByApiKey = new Map<string, string>();
const usageEvents: UsageEventRecord[] = [];
const verifiedPaymentsBySignature = new Map<string, VerifiedPaymentRecord>();
const ALLOWED_SLUGS = new Set([
  "wallet-summary",
  "recent-activity",
  "risk-flags",
  "holder-distribution",
]);

function rememberBudget(budget: BudgetRecord) {
  budgetsById.set(budget.budgetId, budget);

  if (budget.subscriptionId) {
    budgetIdsBySubscription.set(budget.subscriptionId, budget.budgetId);
  }

  if (budget.apiKey) {
    budgetIdsByApiKey.set(budget.apiKey, budget.budgetId);
  }

  return budget;
}

async function seedDevBudget() {
  if (isDatabaseEnabled()) {
    const seededBudget = await initializeBudgetPersistence({
      publisherOrigin: PUBLISHER_ORIGIN,
      solanaRecipient: DEV_SOLANA_RECIPIENT,
      devApiKey: DEV_API_KEY,
      defaultBudgetRefillUsdcMicros: DEFAULT_BUDGET_REFILL_USDC_MICROS,
    });

    if (seededBudget) {
      rememberBudget({
        ...seededBudget,
        apiKey: DEV_API_KEY,
      });
      return;
    }
  }

  const now = new Date().toISOString();
  rememberBudget({
    budgetId: "dev-budget",
    subscriptionId: null,
    ownerEmail: "dev@example.com",
    apiKey: DEV_API_KEY,
    balanceUsdcMicros: DEFAULT_BUDGET_REFILL_USDC_MICROS,
    refillAmountUsdcMicros: DEFAULT_BUDGET_REFILL_USDC_MICROS,
    status: "active",
    lastWebhookEvent: null,
    lastRefilledAt: now,
    updatedAt: now,
  });
}

await (async () => {
  if (process.env.NODE_ENV !== "production") {
    await seedDevBudget();
  }
})();

async function getBudgetByApiKey(apiKey: string | undefined) {
  if (!apiKey) {
    throw new HTTPException(401, {
      message: "Missing X-API-Key header",
    });
  }

  const budgetId = budgetIdsByApiKey.get(apiKey);

  if (!budgetId) {
    const databaseBudget = await getBudgetByApiKeyFromDatabase(apiKey);

    if (!databaseBudget) {
      throw new HTTPException(403, {
        message: "Invalid API key",
      });
    }

    const rememberedBudget = rememberBudget({
      ...databaseBudget,
      apiKey,
    });

    if (rememberedBudget.status !== "active") {
      throw new HTTPException(403, {
        message: `Budget is not active (${rememberedBudget.status})`,
      });
    }

    return rememberedBudget;
  }

  const budget = budgetsById.get(budgetId);

  if (!budget) {
    throw new HTTPException(403, {
      message: "Unknown API key",
    });
  }

  if (budget.status !== "active") {
    throw new HTTPException(403, {
      message: `Budget is not active (${budget.status})`,
    });
  }

  return budget;
}

function ensureSufficientBudget(
  budget: BudgetRecord,
  amountUsdcMicros: number
) {
  if (budget.balanceUsdcMicros < amountUsdcMicros) {
    throw new HTTPException(402, {
      message: `Insufficient budget: requires ${amountUsdcMicros} micro-USDC, has ${budget.balanceUsdcMicros}`,
    });
  }
}

async function debitBudget(budget: BudgetRecord, amountUsdcMicros: number) {
  if (isDatabaseEnabled()) {
    const databaseBudget = await debitBudgetInDatabase(
      budget.budgetId,
      amountUsdcMicros
    );

    if (databaseBudget) {
      return rememberBudget({
        ...databaseBudget,
        apiKey: budget.apiKey,
      });
    }

    throw new HTTPException(402, {
      message: `Insufficient budget: requires ${amountUsdcMicros} micro-USDC, has ${budget.balanceUsdcMicros}`,
    });
  }

  const nextBalance = budget.balanceUsdcMicros - amountUsdcMicros;
  const updatedBudget: BudgetRecord = {
    ...budget,
    balanceUsdcMicros: nextBalance,
    status: nextBalance === 0 ? "exhausted" : budget.status,
    updatedAt: new Date().toISOString(),
  };

  return rememberBudget(updatedBudget);
}

async function recordUsageEvent(input: {
  budget: BudgetRecord | null;
  endpointPath: string;
  method: string;
  statusCode: number;
  billedUsdcMicros: number;
  requestId: string | null;
  callerType?: "human" | "agent";
  paymentTxSignature?: string | null;
}) {
  if (input.budget) {
    const persistedEvent = await recordUsageEventInDatabase({
      budget: input.budget,
      endpointPath: input.endpointPath,
      method: input.method,
      statusCode: input.statusCode,
      billedUsdcMicros: input.billedUsdcMicros,
      requestId: input.requestId ?? input.paymentTxSignature ?? null,
      callerType: input.callerType ?? "human",
    });

    if (persistedEvent) {
      return persistedEvent;
    }
  }

  const event: UsageEventRecord = {
    eventId: randomUUID(),
    budgetId: input.budget?.budgetId ?? "agent-payment",
    ownerEmail: input.budget?.ownerEmail ?? "agent@local",
    subscriptionId: input.budget?.subscriptionId ?? null,
    callerType: input.callerType ?? "human",
    endpointPath: input.endpointPath,
    method: input.method,
    statusCode: input.statusCode,
    billedUsdcMicros: input.billedUsdcMicros,
    budgetBalanceAfterUsdcMicros: input.budget?.balanceUsdcMicros ?? 0,
    requestId: input.requestId ?? input.paymentTxSignature ?? null,
    createdAt: new Date().toISOString(),
  };

  usageEvents.unshift(event);
  if (usageEvents.length > 100) {
    usageEvents.pop();
  }

  return event;
}

async function verifyManualSolanaPayment(txSignature: string) {
  // TODO(D4): this currently verifies native SOL movement on the recipient
  // wallet, NOT USDC. Real implementation must:
  //   1. Find the SPL Token Program instruction in the tx
  //      (programId === TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
  //   2. Confirm instruction is `transfer` or `transferChecked`
  //   3. Resolve destination ATA → owner === DEV_SOLANA_RECIPIENT
  //   4. Resolve mint === USDC mint (devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,
  //      mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
  //   5. Read instruction `amount` and compare to expected price
  // The lamport-based check below is a Day 1 stub for in-memory testing only.

  const existing = verifiedPaymentsBySignature.get(txSignature);

  if (existing) {
    if (existing.consumedAt) {
      throw new HTTPException(409, {
        message: "Payment signature already consumed",
      });
    }

    return existing;
  }

  const tx = await solanaConnection.getParsedTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) {
    throw new HTTPException(400, {
      message: "Transaction not found on Solana RPC",
    });
  }

  if (!tx.meta || tx.meta.err) {
    throw new HTTPException(400, {
      message: "Transaction failed or has no metadata",
    });
  }

  const recipientKey = new PublicKey(DEV_SOLANA_RECIPIENT).toBase58();
  const accountKeys = tx.transaction.message.accountKeys.map((entry) =>
    entry.pubkey.toBase58()
  );
  const recipientIndex = accountKeys.findIndex((key) => key === recipientKey);

  if (recipientIndex === -1) {
    throw new HTTPException(400, {
      message: "Configured recipient wallet not present in transaction",
    });
  }

  const preBalance = tx.meta.preBalances[recipientIndex] ?? 0;
  const postBalance = tx.meta.postBalances[recipientIndex] ?? 0;
  const amountLamports = postBalance - preBalance;

  if (amountLamports < WALLET_SUMMARY_CALL_COST_LAMPORTS) {
    throw new HTTPException(402, {
      message: `Payment too small: expected at least ${WALLET_SUMMARY_CALL_COST_LAMPORTS} lamports, got ${amountLamports}`,
    });
  }

  const payerAddress = accountKeys[0];

  const payment: VerifiedPaymentRecord = {
    paymentId: randomUUID(),
    txSignature,
    payerAddress,
    recipientAddress: recipientKey,
    amountLamports,
    verificationMethod: "manual",
    verificationStatus: "verified",
    consumedAt: null,
    verifiedAt: new Date().toISOString(),
  };

  verifiedPaymentsBySignature.set(txSignature, payment);
  return payment;
}

function markPaymentConsumed(payment: VerifiedPaymentRecord) {
  const updatedPayment: VerifiedPaymentRecord = {
    ...payment,
    consumedAt: new Date().toISOString(),
  };
  verifiedPaymentsBySignature.set(payment.txSignature, updatedPayment);
  return updatedPayment;
}

function verifyDodoSignature(signature: string | undefined) {
  // TODO(D2): replace with HMAC-SHA256(rawBody, DODO_WEBHOOK_SECRET)
  // and timingSafeEqual against the header. The bearer-token equality below
  // is a Day 1 stub — DO NOT ship to prod.
  if (!DODO_WEBHOOK_SECRET) {
    console.warn("[gateway] DODO_WEBHOOK_SECRET unset — webhook is unauthenticated");
    return;
  }

  if (!signature || signature !== DODO_WEBHOOK_SECRET) {
    throw new HTTPException(401, {
      message: "Invalid Dodo webhook signature",
    });
  }
}

function createApiKey() {
  return `ak_${randomUUID().replaceAll("-", "")}`;
}

async function fetchWalletSummaryFromPublisher(input: {
  address: string;
  cluster: string;
}) {
  const target = new URL("/api/wallet-summary", PUBLISHER_ORIGIN);
  target.searchParams.set("address", input.address);
  target.searchParams.set("cluster", input.cluster);

  const response = await fetch(target, {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new HTTPException(502, {
      message: `Publisher wallet-summary failed with ${response.status}: ${body}`,
    });
  }

  return {
    response,
    body,
    data: JSON.parse(body) as WalletSummaryApiResponse,
  };
}

function shapePublisherResponse(
  slug: string,
  data: WalletSummaryApiResponse
): WalletSummaryApiResponse | Record<string, unknown> {
  if (slug === "recent-activity") {
    return {
      address: data.address,
      shortAddress: data.shortAddress,
      cluster: data.cluster,
      explorerUrl: data.explorerUrl,
      recentSignatureCount: data.recentSignatureCount,
      recentSignatures: data.recentSignatures,
      summary:
        data.recentSignatureCount > 0
          ? `Wallet ${data.shortAddress} has ${data.recentSignatureCount} recent transactions available for review on ${data.cluster}.`
          : `Wallet ${data.shortAddress} has no recent transactions available for review on ${data.cluster}.`,
    };
  }

  if (slug === "risk-flags") {
    const riskFlags: string[] = [];

    if (data.solBalance === 0) {
      riskFlags.push("zero_sol_balance");
    }

    if (data.recentSignatureCount === 0) {
      riskFlags.push("no_recent_activity");
    } else if (data.recentSignatureCount < 3) {
      riskFlags.push("low_recent_activity_signal");
    }

    return {
      address: data.address,
      shortAddress: data.shortAddress,
      cluster: data.cluster,
      riskLevel: riskFlags.length >= 2 ? "medium" : "low",
      riskFlags,
      summary:
        riskFlags.length > 0
          ? `Wallet ${data.shortAddress} triggered ${riskFlags.length} heuristic risk flags on ${data.cluster}.`
          : `Wallet ${data.shortAddress} did not trigger heuristic risk flags on ${data.cluster}.`,
    };
  }

  return data;
}

async function fetchPublisherToolResponse(input: {
  slug: string;
  address: string;
  cluster: string;
}): Promise<{
  statusCode: number;
  data: PublisherToolResponse;
}> {
  if (input.slug === "holder-distribution") {
    try {
      return {
        statusCode: 200,
        data: await fetchHolderDistribution({
          address: input.address,
          cluster: input.cluster,
        }),
      };
    } catch (error) {
      const normalizedError = normalizeHolderDistributionError(error);
      throw new HTTPException(normalizedError.statusCode, {
        message: normalizedError.message,
      });
    }
  }

  const upstream = await fetchWalletSummaryFromPublisher({
    address: input.address,
    cluster: input.cluster,
  });

  return {
    statusCode: upstream.response.status,
    data: shapePublisherResponse(input.slug, upstream.data),
  };
}

async function upsertBudgetFromDodo(payload: DodoSubscriptionPayload) {
  const subscriptionId = payload.data?.subscription_id;
  const ownerEmail = payload.data?.customer?.email;

  if (!subscriptionId) {
    throw new HTTPException(400, {
      message: "Missing data.subscription_id in webhook payload",
    });
  }

  if (!ownerEmail) {
    throw new HTTPException(400, {
      message: "Missing data.customer.email in webhook payload",
    });
  }

  if (isDatabaseEnabled()) {
    const databaseBudget = await upsertBudgetFromDodoInDatabase(payload, {
      publisherOrigin: PUBLISHER_ORIGIN,
      solanaRecipient: DEV_SOLANA_RECIPIENT,
      defaultBudgetRefillUsdcMicros: DEFAULT_BUDGET_REFILL_USDC_MICROS,
    });

    if (databaseBudget) {
      return rememberBudget(databaseBudget);
    }
  }

  const existingBudgetId = budgetIdsBySubscription.get(subscriptionId);
  const existingBudget = existingBudgetId
    ? budgetsById.get(existingBudgetId)
    : undefined;

  const now = new Date().toISOString();
  // Dodo `recurring_pre_tax_amount` is in USD cents.
  // Cents → micro-USDC = × 10_000  (1 USDC = 100 cents = 1_000_000 micro-USDC)
  const payloadRefillUsdcMicros = payload.data?.recurring_pre_tax_amount
    ? Number(payload.data.recurring_pre_tax_amount) * 10_000
    : 0;

  const refillAmountUsdcMicros =
    payloadRefillUsdcMicros > 0
      ? payloadRefillUsdcMicros
      : DEFAULT_BUDGET_REFILL_USDC_MICROS;
  const nextStatus =
    payload.data?.status === "cancelled" ? "cancelled" : "active";

  const budget: BudgetRecord = existingBudget
    ? {
        ...existingBudget,
        ownerEmail,
        balanceUsdcMicros:
          nextStatus === "active"
            ? refillAmountUsdcMicros
            : existingBudget.balanceUsdcMicros,
        refillAmountUsdcMicros,
        status: nextStatus,
        lastWebhookEvent: payload.type,
        lastRefilledAt: nextStatus === "active" ? now : existingBudget.lastRefilledAt,
        updatedAt: now,
      }
    : {
        budgetId: randomUUID(),
        subscriptionId,
        ownerEmail,
        apiKey: createApiKey(),
        balanceUsdcMicros: refillAmountUsdcMicros,
        refillAmountUsdcMicros,
        status: nextStatus,
        lastWebhookEvent: payload.type,
        lastRefilledAt: nextStatus === "active" ? now : null,
        updatedAt: now,
      };

  return rememberBudget(budget);
}

app.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "gateway",
    budgetPersistence: isDatabaseEnabled() ? "postgres" : "memory",
    publisherOrigin: PUBLISHER_ORIGIN,
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaRecipient: DEV_SOLANA_RECIPIENT,
  });
});

// Day 1: only `wallet-summary` is supported. Day 2 adds DB-backed publisher lookup.
app.all("/p/:slug", async (c) => {
  const slug = c.req.param("slug");

  if (!ALLOWED_SLUGS.has(slug)) {
    return c.json({ error: `Unknown publisher slug: ${slug}` }, { status: 404 });
  }

  const address = c.req.query("address");
  const cluster = c.req.query("cluster") ?? "devnet";
  const apiKey = c.req.header("x-api-key");
  const solanaTxSignature = c.req.header("x-solana-tx");
  const requestId = c.req.header("x-request-id") ?? null;

  if (apiKey && solanaTxSignature) {
    return c.json(
      { error: "Provide exactly one of X-API-Key or X-Solana-Tx, not both" },
      { status: 400 }
    );
  }

  if (!address) {
    return c.json(
      { error: "Missing required query parameter: address" },
      { status: 400 }
    );
  }

  const isHumanCall = Boolean(apiKey);
  const budget = isHumanCall ? await getBudgetByApiKey(apiKey) : null;
  const verifiedPayment = isHumanCall
    ? null
    : solanaTxSignature
      ? await verifyManualSolanaPayment(solanaTxSignature)
      : null;

  if (!budget && !verifiedPayment) {
    throw new HTTPException(402, {
      message: "Missing payment: provide X-API-Key or X-Solana-Tx",
    });
  }

  if (budget) {
    ensureSufficientBudget(budget, WALLET_SUMMARY_CALL_COST_USDC_MICROS);
  }

  const toolResponse = await fetchPublisherToolResponse({
    slug,
    address,
    cluster,
  });
  const responseBody = toolResponse.data;
  const body = JSON.stringify(responseBody);
  const updatedBudget =
    budget
      ? await debitBudget(budget, WALLET_SUMMARY_CALL_COST_USDC_MICROS)
      : budget;
  const consumedPayment =
    verifiedPayment ? markPaymentConsumed(verifiedPayment) : null;
  const usageEvent = await recordUsageEvent({
    budget: updatedBudget,
    endpointPath: `/p/${slug}`,
    method: c.req.method,
    statusCode: toolResponse.statusCode,
    billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
    requestId,
    callerType: budget ? "human" : "agent",
    paymentTxSignature: consumedPayment?.txSignature ?? null,
  });

  return new Response(body, {
    status: toolResponse.statusCode,
    headers: {
      "content-type": "application/json",
      "x-gateway-proxy": slug,
      "x-publisher-origin": PUBLISHER_ORIGIN,
      "x-budget-id": updatedBudget?.budgetId ?? "agent-payment",
      "x-budget-owner": updatedBudget?.ownerEmail ?? "agent@local",
      "x-budget-balance-usdc-micros": String(
        updatedBudget?.balanceUsdcMicros ?? 0
      ),
      "x-call-cost-usdc-micros": String(WALLET_SUMMARY_CALL_COST_USDC_MICROS),
      "x-call-cost-lamports": String(WALLET_SUMMARY_CALL_COST_LAMPORTS),
      ...(consumedPayment
        ? {
            "x-solana-payment-signature": consumedPayment.txSignature,
            "x-solana-payment-lamports": String(consumedPayment.amountLamports),
          }
        : {}),
      ...(usageEvent ? { "x-usage-event-id": usageEvent.eventId } : {}),
    },
  });
});

app.post("/webhooks/dodo", async (c) => {
  verifyDodoSignature(c.req.header("x-dodo-signature"));

  const payload = (await c.req.json()) as DodoSubscriptionPayload;

  if (!payload.type) {
    throw new HTTPException(400, {
      message: "Missing top-level webhook type",
    });
  }

  const budget = await upsertBudgetFromDodo(payload);

  return c.json({
    ok: true,
    type: payload.type,
    subscriptionId: budget.subscriptionId,
    ownerEmail: budget.ownerEmail,
    budgetId: budget.budgetId,
    balanceUsdcMicros: budget.balanceUsdcMicros,
    refillAmountUsdcMicros: budget.refillAmountUsdcMicros,
    devApiKey: budget.apiKey,
  });
});

app.get("/dev/budgets", async (c) => {
  const databaseBudgets = await listBudgetsFromDatabase();
  const budgetsSource = databaseBudgets ?? Array.from(budgetsById.values());
  const budgets = budgetsSource.map((budget) => ({
    ...budget,
    apiKeyPreview: budget.apiKey ? `${budget.apiKey.slice(0, 8)}...` : null,
  }));

  return c.json({
    count: budgets.length,
    budgets,
  });
});

app.get("/dev/usage-events", async (c) => {
  const databaseUsageEvents = await listUsageEventsFromDatabase();
  const events = [...(databaseUsageEvents ?? []), ...usageEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);

  return c.json({
    count: events.length,
    usageEvents: events,
  });
});

app.get("/dev/payments", (c) => {
  return c.json({
    count: verifiedPaymentsBySignature.size,
    payments: Array.from(verifiedPaymentsBySignature.values()),
  });
});

app.post("/api/runs", async (c) => {
  const body = (await c.req.json()) as {
    prompt?: string;
    publisherSlug?: string;
    targetAddress?: string;
    cluster?: string;
  };

  if (!body.prompt) {
    throw new HTTPException(400, {
      message: "Missing prompt in request body",
    });
  }

  if (!body.targetAddress) {
    throw new HTTPException(400, {
      message: "Missing targetAddress in request body",
    });
  }

  const budget = await getBudgetByApiKey(c.req.header("x-api-key"));
  ensureSufficientBudget(budget, WALLET_SUMMARY_CALL_COST_USDC_MICROS * 5);
  const cluster = body.cluster ?? "devnet";
  let currentBudget = budget;

  const run = await startAgentRun({
    prompt: body.prompt,
    publisherSlug: body.publisherSlug,
    targetAddress: body.targetAddress,
    toolCallCostUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
    executeWalletSummary: async (runId) => {
      const walletSummary = await fetchWalletSummaryFromPublisher({
        address: body.targetAddress!,
        cluster,
      });

      currentBudget = await debitBudget(
        currentBudget,
        WALLET_SUMMARY_CALL_COST_USDC_MICROS
      );
      await recordUsageEvent({
        budget: currentBudget,
        endpointPath: "/p/wallet-summary",
        method: "POST",
        statusCode: 200,
        billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
        requestId: runId,
        callerType: "agent",
      });

      return walletSummary.data;
    },
    executeRecentActivity: async (runId) => {
      const walletSummary = await fetchWalletSummaryFromPublisher({
        address: body.targetAddress!,
        cluster,
      });

      currentBudget = await debitBudget(
        currentBudget,
        WALLET_SUMMARY_CALL_COST_USDC_MICROS
      );
      await recordUsageEvent({
        budget: currentBudget,
        endpointPath: "/p/recent-activity",
        method: "POST",
        statusCode: 200,
        billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
        requestId: runId,
        callerType: "agent",
      });

      return {
        recentSignatureCount: walletSummary.data.recentSignatureCount,
        summary:
          walletSummary.data.recentSignatureCount > 0
            ? `Recent activity tool found ${walletSummary.data.recentSignatureCount} transactions for ${walletSummary.data.shortAddress}.`
            : `Recent activity tool found no recent transactions for ${walletSummary.data.shortAddress}.`,
      };
    },
    executeHolderDistribution: async (runId) => {
      const distribution = await fetchHolderDistribution({
        address: body.targetAddress!,
        cluster,
      });

      currentBudget = await debitBudget(
        currentBudget,
        WALLET_SUMMARY_CALL_COST_USDC_MICROS
      );
      await recordUsageEvent({
        budget: currentBudget,
        endpointPath: "/p/holder-distribution",
        method: "POST",
        statusCode: 200,
        billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
        requestId: runId,
        callerType: "agent",
      });

      return {
        summary: distribution.summary,
        source: distribution.source,
        concentrationScore: distribution.concentrationScore,
        top10Percentage: distribution.top10Percentage,
        top20Percentage: distribution.top20Percentage,
        sampledHolderAccounts: distribution.sampledHolderAccounts,
      };
    },
    executeRiskFlags: async (runId) => {
      const walletSummary = await fetchWalletSummaryFromPublisher({
        address: body.targetAddress!,
        cluster,
      });

      currentBudget = await debitBudget(
        currentBudget,
        WALLET_SUMMARY_CALL_COST_USDC_MICROS
      );
      await recordUsageEvent({
        budget: currentBudget,
        endpointPath: "/p/risk-flags",
        method: "POST",
        statusCode: 200,
        billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
        requestId: runId,
        callerType: "agent",
      });

      const response = shapePublisherResponse(
        "risk-flags",
        walletSummary.data
      ) as {
        riskLevel: "low" | "medium";
        riskFlags: string[];
        summary: string;
      };

      return {
        riskFlags: response.riskFlags,
        riskLevel: response.riskLevel,
        summary: response.summary,
      };
    },
    executeLlmAnalysis: async (runId, context) => {
      const analysis = await generateLlmAnalysis({
        prompt: body.prompt!,
        targetAddress: body.targetAddress!,
        walletSummary: context.walletSummary,
        recentActivity: context.recentActivity,
        holderDistribution: context.holderDistribution,
        riskFlags: context.riskFlags,
      });

      currentBudget = await debitBudget(
        currentBudget,
        WALLET_SUMMARY_CALL_COST_USDC_MICROS
      );
      await recordUsageEvent({
        budget: currentBudget,
        endpointPath: "/internal/llm-analysis",
        method: "POST",
        statusCode: 200,
        billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
        requestId: runId,
        callerType: "agent",
      });

      return analysis;
    },
  });

  return c.json({
    ok: true,
    run,
  });
});

app.get("/api/runs", (c) => {
  const runs = fetchAgentRuns();
  return c.json({
    count: runs.length,
    runs,
  });
});

app.get("/api/runs/:id", (c) => {
  const run = fetchAgentRun(c.req.param("id"));

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json({
    ok: true,
    run,
  });
});

app.get("/api/runs/:id/report", (c) => {
  const run = fetchAgentRun(c.req.param("id"));

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json({
    ok: true,
    report: formatRunReport(run),
  });
});

app.get("/demo", (c) => {
  return c.html(
    renderDemoHomeHtml({
      runs: formatRunListForDemo(),
      defaultApiKey: DEV_API_KEY,
      defaultTargetAddress: DEV_SOLANA_RECIPIENT,
    })
  );
});

app.get("/demo/runs/:id", (c) => {
  const run = fetchAgentRun(c.req.param("id"));

  if (!run) {
    return c.html("<h1>Run not found</h1>", 404);
  }

  const report = formatRunReport(run);

  if (!report) {
    return c.html("<h1>Report unavailable</h1>", 404);
  }

  return c.html(renderRunReportHtml(report));
});

app.post("/verify/solana-tx", async (c) => {
  const body = (await c.req.json()) as { txSignature?: string };

  if (!body.txSignature) {
    throw new HTTPException(400, {
      message: "Missing txSignature in request body",
    });
  }

  const payment = await verifyManualSolanaPayment(body.txSignature);

  return c.json({
    ok: true,
    payment,
  });
});

app.notFound((c) => {
  return c.json(
    {
      error: "Unknown route",
      hint: "Use /p/wallet-summary?address=<solana-address>&cluster=devnet",
    },
    404
  );
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json(
      {
        error: error.message,
      },
      error.status
    );
  }

  console.error("[gateway] unexpected error", error);
  return c.json({ error: "Internal server error" }, 500);
});

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  () => {
    console.log(
      `[gateway] listening on http://localhost:${PORT} -> ${PUBLISHER_ORIGIN}`
    );
  }
);
