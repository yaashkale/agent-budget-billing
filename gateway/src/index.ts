// Day 1 scope: in-memory state only.
// Postgres schema lives in db/migrations/001_initial_schema.sql but is NOT yet wired.
// Drizzle/pg integration lands Day 2 morning.
// Multi-publisher routing, USDC SPL parsing, and HMAC webhook verification land Day 2-4.

import { serve } from "@hono/node-server";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";

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

type BudgetRecord = {
  budgetId: string;
  subscriptionId: string | null;
  ownerEmail: string;
  apiKey: string;
  balanceUsdcMicros: number;
  refillAmountUsdcMicros: number;
  status: "active" | "paused" | "exhausted" | "cancelled";
  lastWebhookEvent: string | null;
  lastRefilledAt: string | null;
  updatedAt: string;
};

type DodoSubscriptionPayload = {
  type: string;
  timestamp?: string;
  data?: {
    subscription_id?: string;
    status?: string;
    recurring_pre_tax_amount?: number;
    customer?: {
      email?: string;
      name?: string;
    };
  };
};

type UsageEventRecord = {
  eventId: string;
  budgetId: string;
  ownerEmail: string;
  subscriptionId: string | null;
  callerType: "human" | "agent";
  endpointPath: string;
  method: string;
  statusCode: number;
  billedUsdcMicros: number;
  budgetBalanceAfterUsdcMicros: number;
  requestId: string | null;
  createdAt: string;
};

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

const budgetsById = new Map<string, BudgetRecord>();
const budgetIdsBySubscription = new Map<string, string>();
const budgetIdsByApiKey = new Map<string, string>();
const usageEvents: UsageEventRecord[] = [];
const verifiedPaymentsBySignature = new Map<string, VerifiedPaymentRecord>();
const ALLOWED_SLUGS = new Set(["wallet-summary"]);

function seedDevBudget() {
  const now = new Date().toISOString();
  const devBudget: BudgetRecord = {
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
  };

  budgetsById.set(devBudget.budgetId, devBudget);
  budgetIdsByApiKey.set(devBudget.apiKey, devBudget.budgetId);
}

if (process.env.NODE_ENV !== "production") {
  seedDevBudget();
}

function getBudgetByApiKey(apiKey: string | undefined) {
  if (!apiKey) {
    throw new HTTPException(401, {
      message: "Missing X-API-Key header",
    });
  }

  const budgetId = budgetIdsByApiKey.get(apiKey);

  if (!budgetId) {
    throw new HTTPException(403, {
      message: "Invalid API key",
    });
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

function debitBudget(budget: BudgetRecord, amountUsdcMicros: number) {
  const nextBalance = budget.balanceUsdcMicros - amountUsdcMicros;
  const updatedBudget: BudgetRecord = {
    ...budget,
    balanceUsdcMicros: nextBalance,
    status: nextBalance === 0 ? "exhausted" : budget.status,
    updatedAt: new Date().toISOString(),
  };

  budgetsById.set(updatedBudget.budgetId, updatedBudget);
  return updatedBudget;
}

function recordUsageEvent(input: {
  budget: BudgetRecord | null;
  endpointPath: string;
  method: string;
  statusCode: number;
  billedUsdcMicros: number;
  requestId: string | null;
  callerType?: "human" | "agent";
  paymentTxSignature?: string | null;
}) {
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

function upsertBudgetFromDodo(payload: DodoSubscriptionPayload) {
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

  budgetsById.set(budget.budgetId, budget);
  budgetIdsBySubscription.set(subscriptionId, budget.budgetId);
  budgetIdsByApiKey.set(budget.apiKey, budget.budgetId);

  return budget;
}

app.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "gateway",
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
  const budget = isHumanCall ? getBudgetByApiKey(apiKey) : null;
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

  const target = new URL("/api/wallet-summary", PUBLISHER_ORIGIN);
  target.searchParams.set("address", address);
  target.searchParams.set("cluster", cluster);

  const response = await fetch(target, {
    method: c.req.method,
    headers: {
      accept: c.req.header("accept") ?? "application/json",
    },
  });

  const body = await response.text();
  const updatedBudget =
    response.ok && budget
      ? debitBudget(budget, WALLET_SUMMARY_CALL_COST_USDC_MICROS)
      : budget;
  const consumedPayment =
    response.ok && verifiedPayment ? markPaymentConsumed(verifiedPayment) : null;
  const usageEvent =
    response.ok
      ? recordUsageEvent({
          budget: updatedBudget,
          endpointPath: "/p/wallet-summary",
          method: c.req.method,
          statusCode: response.status,
          billedUsdcMicros: WALLET_SUMMARY_CALL_COST_USDC_MICROS,
          requestId,
          callerType: budget ? "human" : "agent",
          paymentTxSignature: consumedPayment?.txSignature ?? null,
        })
      : null;

  return new Response(body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
      "x-gateway-proxy": "wallet-summary",
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

  const budget = upsertBudgetFromDodo(payload);

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

app.get("/dev/budgets", (c) => {
  const budgets = Array.from(budgetsById.values()).map((budget) => ({
    ...budget,
    apiKeyPreview: `${budget.apiKey.slice(0, 8)}...`,
  }));

  return c.json({
    count: budgets.length,
    budgets,
  });
});

app.get("/dev/usage-events", (c) => {
  return c.json({
    count: usageEvents.length,
    usageEvents,
  });
});

app.get("/dev/payments", (c) => {
  return c.json({
    count: verifiedPaymentsBySignature.size,
    payments: Array.from(verifiedPaymentsBySignature.values()),
  });
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
