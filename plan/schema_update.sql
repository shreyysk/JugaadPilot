-- ============================================================
-- JugaadPilot — Phase 1 schema update
-- Adds: notes field on investments, per-user target allocation
-- framework, and per-user settings (drift threshold, chatbot
-- check-in style). Designed for Supabase (Postgres + RLS).
-- ============================================================

-- 1. Add notes field to existing investments table
-- ------------------------------------------------------------
alter table investments
  add column if not exists notes text;

-- 2. Asset class enum (shared across target_allocations and investments)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'asset_class') then
    create type asset_class as enum (
      'gold', 'silver', 'mutual_fund', 'indian_stock',
      'us_stock', 'fd', 'cash'
    );
  end if;
end
$$;

-- If investments.asset_class is currently free text, you can migrate it to
-- the enum separately; left untouched here to avoid breaking existing data.

-- 3. Target allocation — one row per user per asset class
-- ------------------------------------------------------------
create table if not exists target_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  asset_class asset_class not null,
  target_percentage numeric(5,2) not null check (target_percentage >= 0 and target_percentage <= 100),
  updated_at timestamptz not null default now(),
  unique (user_id, asset_class)
);

alter table target_allocations enable row level security;

create policy "target_allocations_owner_select"
  on target_allocations for select
  using (auth.uid() = user_id);

create policy "target_allocations_owner_write"
  on target_allocations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enforce that a user's target percentages sum to 100 (checked on write,
-- not a column constraint, since it spans multiple rows).
-- Cash is deliberately excluded from this sum: it's tracked for net-worth
-- purposes but is not part of the rebalanced/investable allocation.
create or replace function check_target_allocation_sums_to_100()
returns trigger as $$
declare
  total numeric(6,2);
begin
  select coalesce(sum(target_percentage), 0)
    into total
    from target_allocations
    where user_id = new.user_id
      and asset_class <> 'cash';

  if total <> 100 then
    raise exception 'Target allocation (excluding cash) for user % sums to %%%, must total 100%%', new.user_id, total;
  end if;

  return new;
end;
$$ language plpgsql;

-- Deferred so all rows in one multi-row upsert are visible before checking
create constraint trigger trg_target_allocation_sum
  after insert or update on target_allocations
  deferrable initially deferred
  for each row
  execute function check_target_allocation_sums_to_100();

-- 4. Per-user settings — drift threshold + chatbot check-in style
-- ------------------------------------------------------------
create table if not exists user_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  drift_threshold_pct numeric(4,2) not null default 5.00,
  chatbot_checkin_style text not null default 'on_demand'
    check (chatbot_checkin_style in ('daily', 'weekly', 'on_demand', 'daily_and_on_demand')),
  ai_provider text not null default 'gemini'
    check (ai_provider in ('gemini', 'claude', 'other')),
  ai_api_key_ciphertext text, -- store encrypted, never plaintext
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user_settings_owner_only"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. Fixed Monthly Investment Plan + Annual Escalation
-- ------------------------------------------------------------
create table if not exists investment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  monthly_amount numeric(12,2) not null check (monthly_amount > 0),
  escalation_pct numeric(5,2) not null default 10.00,
  start_date date not null default current_date,
  last_escalation_date date not null default current_date,
  next_escalation_date date not null default (current_date + interval '1 year'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table investment_plans enable row level security;

create policy "investment_plans_owner_only"
  on investment_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Log of how each month's fixed amount was actually split across asset
-- classes, for audit / "what did I invest and where" history.
create table if not exists monthly_split_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references investment_plans(id) on delete cascade,
  period_month date not null, -- first day of the month this split applies to
  asset_class asset_class not null,
  split_amount numeric(12,2) not null,
  monthly_amount_at_time numeric(12,2) not null, -- plan.monthly_amount when this log was generated
  created_at timestamptz not null default now(),
  unique (plan_id, period_month, asset_class)
);

alter table monthly_split_log enable row level security;

create policy "monthly_split_log_owner_only"
  on monthly_split_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 6. FD-specific fields on investments
-- ------------------------------------------------------------
-- FD doesn't naturally fit "units + purchase price" — it needs a rate
-- and a maturity date instead. Both are nullable since they only apply
-- when asset_class = 'fd'.
alter table investments
  add column if not exists interest_rate_pct numeric(5,2);
alter table investments
  add column if not exists maturity_date date;

-- 7. Ticker/symbol for price auto-fetch
-- ------------------------------------------------------------
-- Free-text `name` stays as the display label; `symbol` is the machine
-- key used to look up live prices (NSE ticker, AMFI scheme code, etc.).
alter table investments
  add column if not exists symbol text;

-- 8. Shared price cache
-- ------------------------------------------------------------
-- One row per (asset_class, symbol) shared across ALL users — avoids
-- redundant API calls when multiple users hold the same instrument.
-- A scheduled job refreshes this; investments/holdings read from it
-- rather than each holding fetching its own price.
create table if not exists price_cache (
  asset_class asset_class not null,
  symbol text not null,
  current_price numeric(14,4) not null,
  currency text not null default 'INR',
  source text not null, -- e.g. 'yahoo_finance', 'amfi_nav', 'gold_api'
  fetched_at timestamptz not null default now(),
  primary key (asset_class, symbol)
);

-- price_cache has no RLS — it's shared reference data, not per-user.
-- Only the scheduled fetch job (service role) writes to it; the app
-- reads it for every user.

-- Rolling price history, for the drop%/rise% alert rules below.
-- Kept separate from price_cache so the cache table stays small/fast.
create table if not exists price_history (
  asset_class asset_class not null,
  symbol text not null,
  price numeric(14,4) not null,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_price_history_lookup
  on price_history (asset_class, symbol, recorded_at desc);

-- 9. Notification settings — zero-cost delivery design
-- ------------------------------------------------------------
-- Telegram's Bot API has no per-message fee (unlike WhatsApp Business
-- Cloud API, which started charging per template message outside a
-- user-opened window). Once a user starts a chat with the bot (/start),
-- the bot can message them freely in both directions — no deep-link
-- workaround needed, and inline keyboard buttons (Yes/No) work natively.
alter table user_settings
  add column if not exists telegram_chat_id text; -- captured when the user sends /start to the bot
alter table user_settings
  add column if not exists alert_channel text not null default 'telegram'
    check (alert_channel in ('telegram', 'push', 'both'));

-- 10. Price alert rules — deterministic "flag this" triggers
-- ------------------------------------------------------------
create table if not exists price_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  holding_id uuid references investments(id) on delete cascade, -- null = applies to the whole asset class
  asset_class asset_class not null,
  rule_type text not null
    check (rule_type in ('price_drop_pct', 'price_rise_pct', 'target_price', 'stop_loss_price')),
  threshold_value numeric(14,4) not null, -- % for drop/rise, ₹ for target/stop_loss
  lookback_days int not null default 7, -- used by drop_pct / rise_pct only
  is_active boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table price_alert_rules enable row level security;

create policy "price_alert_rules_owner_only"
  on price_alert_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 11. General alerts outbox (drift, monthly check-in, price opportunities)
-- ------------------------------------------------------------
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  alert_type text not null
    check (alert_type in ('drift', 'monthly_checkin', 'price_opportunity', 'sell_signal', 'daily_checkin')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  message text not null,
  related_id uuid, -- e.g. price_alert_rules.id, monthly_split_log.id
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'awaiting_reply', 'acknowledged', 'expired')),
  channel text not null default 'telegram', -- 'telegram' | 'push'
  external_message_id text, -- Telegram message_id, for editing/correlating replies via webhook
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  resolved_at timestamptz
);

alter table alerts enable row level security;

create policy "alerts_owner_only"
  on alerts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 12. Monthly split log: track confirmation + rollover state
-- ------------------------------------------------------------
alter table monthly_split_log
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'confirmed_invested', 'skipped_rolled_over'));
alter table monthly_split_log
  add column if not exists alert_id uuid references alerts(id);

alter table investment_plans
  add column if not exists rollover_amount numeric(12,2) not null default 0;
  -- amount carried forward from a skipped month, added on top of
  -- monthly_amount when computing the NEXT month's split


-- 60/15/10/5/5/5 across the six investable classes sums to exactly 100%.
-- Cash still gets a row (for the dashboard/net-worth view) but is
-- excluded from the 100% check above and from drift calculations.
-- ============================================================
-- insert into target_allocations (user_id, asset_class, target_percentage) values
--   ('<user-uuid>', 'gold', 60),
--   ('<user-uuid>', 'silver', 15),
--   ('<user-uuid>', 'mutual_fund', 10),
--   ('<user-uuid>', 'indian_stock', 5),
--   ('<user-uuid>', 'us_stock', 5),
--   ('<user-uuid>', 'fd', 5),
--   ('<user-uuid>', 'cash', 0); -- informational only, not rebalanced against
--
-- insert into user_settings (user_id, drift_threshold_pct, chatbot_checkin_style)
-- values ('<user-uuid>', 5.00, 'daily_and_on_demand');
