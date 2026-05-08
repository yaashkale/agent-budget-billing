ALTER TABLE usage_events
ADD COLUMN IF NOT EXISTS budget_id UUID REFERENCES user_budgets(id) ON DELETE SET NULL;

UPDATE usage_events ue
SET budget_id = ub.id
FROM api_keys ak,
     user_budgets ub
WHERE ue.api_key_id = ak.id
  AND ub.publisher_id = ue.publisher_id
  AND ub.subscription_id IS NOT DISTINCT FROM ak.subscription_id
  AND ue.budget_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_usage_events_budget_id ON usage_events(budget_id);
