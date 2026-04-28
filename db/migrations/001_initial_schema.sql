CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE publishers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    contact_email TEXT,
    origin_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
    solana_recipient TEXT NOT NULL,
    authority_pubkey TEXT,
    default_human_call_price_usd_cents INTEGER NOT NULL DEFAULT 5 CHECK (default_human_call_price_usd_cents >= 0),
    default_agent_call_price_usdc_micros BIGINT NOT NULL DEFAULT 1000 CHECK (default_agent_call_price_usdc_micros >= 0),
    settlement_window_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (settlement_window_seconds > 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    caller_type TEXT NOT NULL CHECK (caller_type IN ('human', 'agent')),
    endpoint_pattern TEXT NOT NULL DEFAULT '*',
    price_usd_cents INTEGER,
    price_usdc_micros BIGINT,
    priority INTEGER NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (price_usd_cents IS NOT NULL OR price_usdc_micros IS NOT NULL)
);

CREATE TABLE dodo_subscriptions (
    id TEXT PRIMARY KEY,
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    customer_email TEXT NOT NULL,
    customer_name TEXT,
    dodo_customer_id TEXT,
    product_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'on_hold', 'cancelled', 'expired', 'past_due')),
    recurring_amount_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (recurring_amount_usd_cents >= 0),
    budget_refill_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (budget_refill_usdc_micros >= 0),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    next_billing_date TIMESTAMPTZ,
    last_webhook_event TEXT,
    last_webhook_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES dodo_subscriptions(id) ON DELETE SET NULL,
    key_prefix TEXT NOT NULL,
    key_hash BYTEA NOT NULL,
    label TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending_dodo', 'active', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publisher_id, key_prefix)
);

CREATE TABLE user_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES dodo_subscriptions(id) ON DELETE SET NULL,
    owner_email TEXT NOT NULL,
    owner_wallet TEXT,
    currency TEXT NOT NULL DEFAULT 'USDC',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'exhausted', 'cancelled')),
    balance_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (balance_usdc_micros >= 0),
    reserved_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (reserved_usdc_micros >= 0),
    refill_amount_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (refill_amount_usdc_micros >= 0),
    hard_limit_usdc_micros BIGINT,
    billing_cycle_anchor TIMESTAMPTZ,
    last_refilled_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (hard_limit_usdc_micros IS NULL OR hard_limit_usdc_micros >= 0)
);

CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    budget_id UUID REFERENCES user_budgets(id) ON DELETE SET NULL,
    initiated_by_email TEXT,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    budget_allocated_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (budget_allocated_usdc_micros >= 0),
    budget_spent_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (budget_spent_usdc_micros >= 0),
    result_summary TEXT,
    result_artifact JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE x402_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    budget_id UUID REFERENCES user_budgets(id) ON DELETE SET NULL,
    payer_address TEXT,
    recipient_address TEXT NOT NULL,
    amount_usdc_micros BIGINT NOT NULL CHECK (amount_usdc_micros >= 0),
    tx_signature TEXT NOT NULL UNIQUE,
    verification_method TEXT NOT NULL DEFAULT 'manual' CHECK (verification_method IN ('x402', 'manual')),
    verification_status TEXT NOT NULL DEFAULT 'verified' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    consumed_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settlement_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    window_index BIGINT NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed_pending_commit', 'committed', 'failed')),
    merkle_root BYTEA,
    prev_window_hash BYTEA,
    total_calls BIGINT NOT NULL DEFAULT 0 CHECK (total_calls >= 0),
    total_revenue_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (total_revenue_usdc_micros >= 0),
    total_revenue_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_revenue_usd_cents >= 0),
    on_chain_tx_signature TEXT,
    on_chain_window_pda TEXT,
    commit_attempts INTEGER NOT NULL DEFAULT 0 CHECK (commit_attempts >= 0),
    last_commit_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publisher_id, window_index)
);

CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    x402_payment_id UUID REFERENCES x402_payments(id) ON DELETE SET NULL,
    agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    settlement_window_id UUID REFERENCES settlement_windows(id) ON DELETE SET NULL,
    caller_type TEXT NOT NULL CHECK (caller_type IN ('human', 'agent')),
    endpoint_path TEXT NOT NULL,
    method TEXT NOT NULL,
    request_id TEXT,
    status_code INTEGER NOT NULL CHECK (status_code >= 100 AND status_code <= 599),
    request_bytes INTEGER NOT NULL DEFAULT 0 CHECK (request_bytes >= 0),
    response_bytes INTEGER NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
    billed_usdc_micros BIGINT NOT NULL DEFAULT 0 CHECK (billed_usdc_micros >= 0),
    billed_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (billed_usd_cents >= 0),
    budget_balance_after_usdc_micros BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (api_key_id IS NOT NULL AND x402_payment_id IS NULL)
        OR (api_key_id IS NULL AND x402_payment_id IS NOT NULL)
        OR (api_key_id IS NOT NULL AND agent_run_id IS NOT NULL)
    )
);

CREATE INDEX idx_publishers_slug ON publishers(slug);
CREATE INDEX idx_pricing_rules_publisher_priority ON pricing_rules(publisher_id, priority) WHERE active = TRUE;
CREATE INDEX idx_dodo_subscriptions_publisher_status ON dodo_subscriptions(publisher_id, status);
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_subscription_id ON api_keys(subscription_id);
CREATE INDEX idx_user_budgets_subscription_id ON user_budgets(subscription_id);
CREATE INDEX idx_user_budgets_owner_email ON user_budgets(owner_email);
CREATE INDEX idx_agent_runs_budget_status ON agent_runs(budget_id, status);
CREATE INDEX idx_x402_payments_budget_status ON x402_payments(budget_id, verification_status);
CREATE INDEX idx_settlement_windows_publisher_status ON settlement_windows(publisher_id, status, end_at);
CREATE INDEX idx_usage_events_publisher_created ON usage_events(publisher_id, created_at);
CREATE INDEX idx_usage_events_window ON usage_events(settlement_window_id);
CREATE INDEX idx_usage_events_agent_run ON usage_events(agent_run_id);
CREATE INDEX idx_usage_events_request_id ON usage_events(request_id) WHERE request_id IS NOT NULL;
