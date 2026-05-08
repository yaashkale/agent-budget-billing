import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

export type BudgetRecord = {
  budgetId: string;
  publisherId?: string | null;
  apiKeyId?: string | null;
  subscriptionId: string | null;
  ownerEmail: string;
  apiKey: string | null;
  balanceUsdcMicros: number;
  refillAmountUsdcMicros: number;
  status: "active" | "paused" | "exhausted" | "cancelled";
  lastWebhookEvent: string | null;
  lastRefilledAt: string | null;
  updatedAt: string;
};

export type DodoSubscriptionPayload = {
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

export type UsageEventRecord = {
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

const DEFAULT_PUBLISHER_SLUG =
  process.env.DEFAULT_PUBLISHER_SLUG ?? "publisher-0";
const DATABASE_URL = process.env.DATABASE_URL ?? null;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
    })
  : null;

let defaultPublisherIdPromise: Promise<string> | null = null;

type DatabaseBudgetRow = {
  budget_id: string;
  publisher_id: string;
  api_key_id: string | null;
  subscription_id: string | null;
  owner_email: string;
  balance_usdc_micros: string | number;
  refill_amount_usdc_micros: string | number;
  status: BudgetRecord["status"];
  last_webhook_event: string | null;
  last_refilled_at: string | Date | null;
  updated_at: string | Date;
  api_key_preview: string | null;
};

function parseIsoTimestamp(value: string | Date | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toBudgetRecord(
  row: DatabaseBudgetRow,
  apiKeyOverride?: string | null
): BudgetRecord {
  return {
    budgetId: row.budget_id,
    publisherId: row.publisher_id,
    apiKeyId: row.api_key_id,
    subscriptionId: row.subscription_id,
    ownerEmail: row.owner_email,
    apiKey: apiKeyOverride ?? row.api_key_preview,
    balanceUsdcMicros: Number(row.balance_usdc_micros),
    refillAmountUsdcMicros: Number(row.refill_amount_usdc_micros),
    status: row.status,
    lastWebhookEvent: row.last_webhook_event,
    lastRefilledAt: parseIsoTimestamp(row.last_refilled_at),
    updatedAt:
      parseIsoTimestamp(row.updated_at) ?? new Date().toISOString(),
  };
}

function getApiKeyPrefix(apiKey: string) {
  return apiKey.slice(0, 8);
}

function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest();
}

function getBudgetLookupSql() {
  return `
    SELECT
      ub.id AS budget_id,
      ub.publisher_id,
      ak.id AS api_key_id,
      ub.subscription_id,
      ub.owner_email,
      ub.balance_usdc_micros,
      ub.refill_amount_usdc_micros,
      ub.status,
      ds.last_webhook_event,
      ub.last_refilled_at,
      ub.updated_at,
      CONCAT(ak.key_prefix, '...') AS api_key_preview
    FROM api_keys ak
    JOIN user_budgets ub
      ON ub.publisher_id = ak.publisher_id
     AND ub.subscription_id IS NOT DISTINCT FROM ak.subscription_id
    LEFT JOIN dodo_subscriptions ds
      ON ds.id = ub.subscription_id
    WHERE ak.key_prefix = $1
      AND ak.key_hash = $2
      AND ak.status = 'active'
    LIMIT 1
  `;
}

async function ensureDefaultPublisher(input: {
  publisherOrigin: string;
  solanaRecipient: string;
}) {
  if (!pool) {
    throw new Error("Database pool is not configured");
  }

  if (!defaultPublisherIdPromise) {
    defaultPublisherIdPromise = (async () => {
      const result = await pool.query<{ id: string }>(
        `
          INSERT INTO publishers (
            name,
            slug,
            origin_url,
            solana_recipient
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (slug)
          DO UPDATE
          SET
            name = EXCLUDED.name,
            origin_url = EXCLUDED.origin_url,
            solana_recipient = EXCLUDED.solana_recipient,
            updated_at = NOW()
          RETURNING id
        `,
        ["Publisher 0", DEFAULT_PUBLISHER_SLUG, input.publisherOrigin, input.solanaRecipient]
      );

      return result.rows[0].id;
    })();
  }

  return defaultPublisherIdPromise;
}

export function isDatabaseEnabled() {
  return Boolean(pool);
}

export async function initializeBudgetPersistence(input: {
  publisherOrigin: string;
  solanaRecipient: string;
  devApiKey: string;
  defaultBudgetRefillUsdcMicros: number;
}) {
  if (!pool) {
    return null;
  }

  const publisherId = await ensureDefaultPublisher(input);
  const existingBudget = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM user_budgets
      WHERE publisher_id = $1
        AND owner_email = $2
        AND subscription_id IS NULL
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [publisherId, "dev@example.com"]
  );

  const budgetId =
    existingBudget.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `
          INSERT INTO user_budgets (
            publisher_id,
            owner_email,
            status,
            balance_usdc_micros,
            refill_amount_usdc_micros,
            last_refilled_at
          )
          VALUES ($1, $2, 'active', $3, $3, NOW())
          RETURNING id
        `,
        [publisherId, "dev@example.com", input.defaultBudgetRefillUsdcMicros]
      )
    ).rows[0].id;

  await pool.query(
    `
      INSERT INTO api_keys (
        publisher_id,
        subscription_id,
        key_prefix,
        key_hash,
        label,
        status
      )
      VALUES ($1, NULL, $2, $3, $4, 'active')
      ON CONFLICT (publisher_id, key_prefix)
      DO UPDATE
      SET
        key_hash = EXCLUDED.key_hash,
        label = EXCLUDED.label,
        status = 'active'
    `,
    [
      publisherId,
      getApiKeyPrefix(input.devApiKey),
      hashApiKey(input.devApiKey),
      "seeded-dev-key",
    ]
  );

  const budget = await getBudgetByApiKeyFromDatabase(input.devApiKey);

  if (!budget) {
    throw new Error(`Unable to load seeded budget ${budgetId}`);
  }

  return budget;
}

export async function getBudgetByApiKeyFromDatabase(apiKey: string) {
  if (!pool) {
    return null;
  }

  const result = await pool.query<DatabaseBudgetRow>(getBudgetLookupSql(), [
    getApiKeyPrefix(apiKey),
    hashApiKey(apiKey),
  ]);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  await pool.query(
    `
      UPDATE api_keys
      SET last_used_at = NOW()
      WHERE key_prefix = $1
        AND key_hash = $2
    `,
    [getApiKeyPrefix(apiKey), hashApiKey(apiKey)]
  );

  return toBudgetRecord(row, apiKey);
}

export async function debitBudgetInDatabase(
  budgetId: string,
  amountUsdcMicros: number
) {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{
    budget_id: string;
    publisher_id: string;
    subscription_id: string | null;
    owner_email: string;
    balance_usdc_micros: string | number;
    refill_amount_usdc_micros: string | number;
    status: BudgetRecord["status"];
    last_refilled_at: string | Date | null;
    updated_at: string | Date;
  }>(
    `
      UPDATE user_budgets
      SET
        balance_usdc_micros = balance_usdc_micros - $2,
        status = CASE
          WHEN status = 'active' AND balance_usdc_micros - $2 <= 0 THEN 'exhausted'
          ELSE status
        END,
        updated_at = NOW()
      WHERE id = $1
        AND status = 'active'
        AND balance_usdc_micros >= $2
      RETURNING
        id AS budget_id,
        publisher_id,
        subscription_id,
        owner_email,
        balance_usdc_micros,
        refill_amount_usdc_micros,
        status,
        last_refilled_at,
        updated_at
    `,
    [budgetId, amountUsdcMicros]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const metadataResult = await pool.query<{
    last_webhook_event: string | null;
    api_key_id: string | null;
    api_key_preview: string | null;
  }>(
    `
      SELECT
        ds.last_webhook_event,
        ak.id AS api_key_id,
        CONCAT(ak.key_prefix, '...') AS api_key_preview
      FROM user_budgets ub
      LEFT JOIN dodo_subscriptions ds
        ON ds.id = ub.subscription_id
      LEFT JOIN api_keys ak
        ON ak.publisher_id = ub.publisher_id
       AND ak.subscription_id IS NOT DISTINCT FROM ub.subscription_id
       AND ak.status = 'active'
      WHERE ub.id = $1
      ORDER BY ak.created_at DESC NULLS LAST
      LIMIT 1
    `,
    [budgetId]
  );

  return toBudgetRecord({
    ...row,
    api_key_id: metadataResult.rows[0]?.api_key_id ?? null,
    last_webhook_event: metadataResult.rows[0]?.last_webhook_event ?? null,
    api_key_preview: metadataResult.rows[0]?.api_key_preview ?? null,
  });
}

export async function upsertBudgetFromDodoInDatabase(
  payload: DodoSubscriptionPayload,
  input: {
    publisherOrigin: string;
    solanaRecipient: string;
    defaultBudgetRefillUsdcMicros: number;
  }
) {
  if (!pool) {
    return null;
  }

  const subscriptionId = payload.data?.subscription_id;
  const ownerEmail = payload.data?.customer?.email;

  if (!subscriptionId || !ownerEmail) {
    return null;
  }

  const publisherId = await ensureDefaultPublisher(input);
  const recurringAmountUsdCents = Number(
    payload.data?.recurring_pre_tax_amount ?? 0
  );
  const refillAmountUsdcMicros =
    recurringAmountUsdCents > 0
      ? recurringAmountUsdCents * 10_000
      : input.defaultBudgetRefillUsdcMicros;
  const nextStatus =
    payload.data?.status === "cancelled" ? "cancelled" : "active";

  await pool.query(
    `
      INSERT INTO dodo_subscriptions (
        id,
        publisher_id,
        customer_email,
        customer_name,
        status,
        recurring_amount_usd_cents,
        budget_refill_usdc_micros,
        last_webhook_event,
        last_webhook_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (id)
      DO UPDATE
      SET
        customer_email = EXCLUDED.customer_email,
        customer_name = EXCLUDED.customer_name,
        status = EXCLUDED.status,
        recurring_amount_usd_cents = EXCLUDED.recurring_amount_usd_cents,
        budget_refill_usdc_micros = EXCLUDED.budget_refill_usdc_micros,
        last_webhook_event = EXCLUDED.last_webhook_event,
        last_webhook_at = NOW(),
        updated_at = NOW()
    `,
    [
      subscriptionId,
      publisherId,
      ownerEmail,
      payload.data?.customer?.name ?? null,
      payload.data?.status ?? "active",
      recurringAmountUsdCents,
      refillAmountUsdcMicros,
      payload.type,
    ]
  );

  const existingBudget = await pool.query<DatabaseBudgetRow>(
    `
      SELECT
        ub.id AS budget_id,
        ub.publisher_id,
        ak.id AS api_key_id,
        ub.subscription_id,
        ub.owner_email,
        ub.balance_usdc_micros,
        ub.refill_amount_usdc_micros,
        ub.status,
        ds.last_webhook_event,
        ub.last_refilled_at,
        ub.updated_at,
        CONCAT(ak.key_prefix, '...') AS api_key_preview
      FROM user_budgets ub
      LEFT JOIN dodo_subscriptions ds
        ON ds.id = ub.subscription_id
      LEFT JOIN api_keys ak
        ON ak.publisher_id = ub.publisher_id
       AND ak.subscription_id IS NOT DISTINCT FROM ub.subscription_id
       AND ak.status = 'active'
      WHERE ub.publisher_id = $1
        AND ub.subscription_id = $2
      ORDER BY ak.created_at DESC NULLS LAST
      LIMIT 1
    `,
    [publisherId, subscriptionId]
  );

  if (existingBudget.rows[0]) {
    const updatedBudget = await pool.query<DatabaseBudgetRow>(
      `
        UPDATE user_budgets
        SET
          owner_email = $2,
          balance_usdc_micros = CASE
            WHEN $3 = 'active' THEN $4
            ELSE balance_usdc_micros
          END,
          refill_amount_usdc_micros = $4,
          status = $3,
          last_refilled_at = CASE
            WHEN $3 = 'active' THEN NOW()
            ELSE last_refilled_at
          END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id AS budget_id,
          publisher_id,
          NULL::uuid AS api_key_id,
          subscription_id,
          owner_email,
          balance_usdc_micros,
          refill_amount_usdc_micros,
          status,
          $5::text AS last_webhook_event,
          last_refilled_at,
          updated_at,
          NULL::text AS api_key_preview
      `,
      [
        existingBudget.rows[0].budget_id,
        ownerEmail,
        nextStatus,
        refillAmountUsdcMicros,
        payload.type,
      ]
    );

    return toBudgetRecord(updatedBudget.rows[0]);
  }

  const insertedBudget = await pool.query<DatabaseBudgetRow>(
    `
      INSERT INTO user_budgets (
        publisher_id,
        subscription_id,
        owner_email,
        status,
        balance_usdc_micros,
        refill_amount_usdc_micros,
        last_refilled_at
      )
      VALUES ($1, $2, $3, $4, $5, $5, CASE WHEN $4 = 'active' THEN NOW() ELSE NULL END)
      RETURNING
        id AS budget_id,
        publisher_id,
        NULL::uuid AS api_key_id,
        subscription_id,
        owner_email,
        balance_usdc_micros,
        refill_amount_usdc_micros,
        status,
        $6::text AS last_webhook_event,
        last_refilled_at,
        updated_at,
        NULL::text AS api_key_preview
    `,
    [
      publisherId,
      subscriptionId,
      ownerEmail,
      nextStatus,
      refillAmountUsdcMicros,
      payload.type,
    ]
  );

  const apiKey = `ak_${randomUUID().replaceAll("-", "")}`;

  await pool.query(
    `
      INSERT INTO api_keys (
        publisher_id,
        subscription_id,
        key_prefix,
        key_hash,
        label,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'active')
    `,
    [
      publisherId,
      subscriptionId,
      getApiKeyPrefix(apiKey),
      hashApiKey(apiKey),
      `subscriber-${ownerEmail}`,
    ]
  );

  const hydratedBudget = await getBudgetByApiKeyFromDatabase(apiKey);

  if (hydratedBudget) {
    return {
      ...hydratedBudget,
      apiKey,
    };
  }

  return toBudgetRecord(insertedBudget.rows[0], apiKey);
}

export async function listBudgetsFromDatabase() {
  if (!pool) {
    return null;
  }

  const result = await pool.query<DatabaseBudgetRow>(
    `
      SELECT
        ub.id AS budget_id,
        ub.publisher_id,
        MAX(ak.id::text) AS api_key_id,
        ub.subscription_id,
        ub.owner_email,
        ub.balance_usdc_micros,
        ub.refill_amount_usdc_micros,
        ub.status,
        ds.last_webhook_event,
        ub.last_refilled_at,
        ub.updated_at,
        MAX(CONCAT(ak.key_prefix, '...')) AS api_key_preview
      FROM user_budgets ub
      LEFT JOIN dodo_subscriptions ds
        ON ds.id = ub.subscription_id
      LEFT JOIN api_keys ak
        ON ak.publisher_id = ub.publisher_id
       AND ak.subscription_id IS NOT DISTINCT FROM ub.subscription_id
       AND ak.status = 'active'
      GROUP BY
        ub.id,
        ub.publisher_id,
        ub.subscription_id,
        ub.owner_email,
        ub.balance_usdc_micros,
        ub.refill_amount_usdc_micros,
        ub.status,
        ds.last_webhook_event,
        ub.last_refilled_at,
        ub.updated_at
      ORDER BY ub.updated_at DESC
    `
  );

  return result.rows.map((row) => toBudgetRecord(row));
}

export async function recordUsageEventInDatabase(input: {
  budget: BudgetRecord;
  endpointPath: string;
  method: string;
  statusCode: number;
  billedUsdcMicros: number;
  requestId: string | null;
  callerType: "human" | "agent";
}) {
  if (!pool || !input.budget.publisherId || !input.budget.apiKeyId) {
    return null;
  }

  const result = await pool.query<{
    event_id: string;
    created_at: string | Date;
  }>(
    `
      INSERT INTO usage_events (
        publisher_id,
        budget_id,
        api_key_id,
        caller_type,
        endpoint_path,
        method,
        request_id,
        status_code,
        billed_usdc_micros,
        billed_usd_cents,
        budget_balance_after_usdc_micros
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id AS event_id, created_at
    `,
    [
      input.budget.publisherId,
      input.budget.budgetId,
      input.budget.apiKeyId,
      input.callerType,
      input.endpointPath,
      input.method,
      input.requestId,
      input.statusCode,
      input.billedUsdcMicros,
      Math.floor(input.billedUsdcMicros / 10_000),
      input.budget.balanceUsdcMicros,
    ]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    eventId: row.event_id,
    budgetId: input.budget.budgetId,
    ownerEmail: input.budget.ownerEmail,
    subscriptionId: input.budget.subscriptionId,
    callerType: input.callerType,
    endpointPath: input.endpointPath,
    method: input.method,
    statusCode: input.statusCode,
    billedUsdcMicros: input.billedUsdcMicros,
    budgetBalanceAfterUsdcMicros: input.budget.balanceUsdcMicros,
    requestId: input.requestId,
    createdAt: parseIsoTimestamp(row.created_at) ?? new Date().toISOString(),
  } satisfies UsageEventRecord;
}

export async function listUsageEventsFromDatabase() {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{
    event_id: string;
    budget_id: string | null;
    owner_email: string | null;
    subscription_id: string | null;
    caller_type: "human" | "agent";
    endpoint_path: string;
    method: string;
    status_code: number;
    billed_usdc_micros: string | number;
    budget_balance_after_usdc_micros: string | number | null;
    request_id: string | null;
    created_at: string | Date;
  }>(
    `
      SELECT
        ue.id AS event_id,
        ue.budget_id,
        ub.owner_email,
        ub.subscription_id,
        ue.caller_type,
        ue.endpoint_path,
        ue.method,
        ue.status_code,
        ue.billed_usdc_micros,
        ue.budget_balance_after_usdc_micros,
        ue.request_id,
        ue.created_at
      FROM usage_events ue
      LEFT JOIN user_budgets ub
        ON ub.id = ue.budget_id
      ORDER BY ue.created_at DESC
      LIMIT 100
    `
  );

  return result.rows.map((row) => ({
    eventId: row.event_id,
    budgetId: row.budget_id ?? "agent-payment",
    ownerEmail: row.owner_email ?? "agent@local",
    subscriptionId: row.subscription_id,
    callerType: row.caller_type,
    endpointPath: row.endpoint_path,
    method: row.method,
    statusCode: row.status_code,
    billedUsdcMicros: Number(row.billed_usdc_micros),
    budgetBalanceAfterUsdcMicros: Number(
      row.budget_balance_after_usdc_micros ?? 0
    ),
    requestId: row.request_id,
    createdAt: parseIsoTimestamp(row.created_at) ?? new Date().toISOString(),
  })) satisfies UsageEventRecord[];
}
