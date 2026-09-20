-- ============================================================
-- JugaadPilot — Phase 2 schema update
-- Adds: named goals, loan/EMI tracker, insurance tracker,
-- expense manager + urgent-expense funding log, capital-gains
-- sale records, round-up investing, and CAS/CAMS import staging.
-- Builds on schema_update.sql (Phase 1). Supabase (Postgres + RLS).
-- ============================================================

-- 1. Goals — multiple named targets, each optionally fed by its
--    own investment_plans row (reuses the existing monthly planner
--    rather than inventing a parallel system).
-- ------------------------------------------------------------
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null, -- e.g. "Retirement", "Goa trip", "Emergency fund"
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date date, -- nullable: some goals (emergency fund) are open-ended
  priority int not null default 0, -- lower = higher priority, for display ordering only
  is_achieved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table goals enable row level security;

create policy "goals_owner_only"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A plan can now feed a specific goal instead of the general pool.
-- Null = general investing, not earmarked to any one goal.
alter table investment_plans
  add column if not exists goal_id uuid references goals(id) on delete set null;

-- A holding can optionally be earmarked to a goal too (e.g. this FD is
-- "the emergency fund"), independent of which plan bought it.
alter table investments
  add column if not exists goal_id uuid references goals(id) on delete set null;

-- Progress is a view, not a stored column, so it's always correct:
-- sum of earmarked holdings' current_value + sum of monthly_split_log
-- rows confirmed for plans tied to that goal (covers cash not yet
-- reflected as a holding row).
create or replace view goal_progress as
select
  g.id as goal_id,
  g.user_id,
  g.name,
  g.target_amount,
  g.target_date,
  coalesce(h.holdings_value, 0) as holdings_value,
  coalesce(p.confirmed_contributions, 0) as confirmed_contributions,
  coalesce(h.holdings_value, 0) + coalesce(p.confirmed_contributions, 0) as current_amount
from goals g
left join (
  select goal_id, sum(current_value) as holdings_value
  from investments
  where goal_id is not null
  group by goal_id
) h on h.goal_id = g.id
left join (
  select ip.goal_id, sum(msl.split_amount) as confirmed_contributions
  from monthly_split_log msl
  join investment_plans ip on ip.id = msl.plan_id
  where ip.goal_id is not null and msl.status = 'confirmed_invested'
  group by ip.goal_id
) p on p.goal_id = g.id;

-- 2. Loans / EMI tracker — sits alongside investments for a full
--    net-worth picture (liabilities, not just assets).
-- ------------------------------------------------------------
create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null, -- e.g. "Home loan — HDFC", "Car loan"
  loan_type text not null default 'other'
    check (loan_type in ('home', 'car', 'personal', 'education', 'credit_card', 'other')),
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  outstanding_balance numeric(14,2) not null check (outstanding_balance >= 0),
  interest_rate_pct numeric(5,2) not null,
  emi_amount numeric(12,2) not null check (emi_amount > 0),
  tenure_months int not null check (tenure_months > 0),
  start_date date not null,
  emi_due_day int not null default 5 check (emi_due_day between 1 and 28),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table loans enable row level security;

create policy "loans_owner_only"
  on loans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Payment log — lets outstanding_balance be recomputed/audited rather
-- than trusted as a single mutable field, and gives EMI-vs-actual history.
create table if not exists loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references loans(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  payment_date date not null,
  amount_paid numeric(12,2) not null check (amount_paid > 0),
  principal_component numeric(12,2),
  interest_component numeric(12,2),
  is_prepayment boolean not null default false,
  created_at timestamptz not null default now()
);

alter table loan_payments enable row level security;

create policy "loan_payments_owner_only"
  on loan_payments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Insurance tracker
-- ------------------------------------------------------------
create table if not exists insurance_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  policy_type text not null check (policy_type in ('term', 'health', 'other')),
  provider text not null,
  policy_number text,
  sum_assured numeric(14,2) not null check (sum_assured > 0),
  premium_amount numeric(12,2) not null check (premium_amount > 0),
  premium_frequency text not null default 'annual'
    check (premium_frequency in ('monthly', 'quarterly', 'annual', 'single')),
  start_date date not null,
  renewal_date date,
  nominee text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table insurance_policies enable row level security;

create policy "insurance_policies_owner_only"
  on insurance_policies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. Expense manager
-- ------------------------------------------------------------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'other',
  description text,
  expense_date date not null default current_date,
  is_urgent boolean not null default false, -- true = flagged as needing to be funded now
  funded_by text not null default 'income'
    check (funded_by in ('income', 'savings', 'sold_investments', 'loan', 'unfunded')),
  created_at timestamptz not null default now()
);

alter table expenses enable row level security;

create policy "expenses_owner_only"
  on expenses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- When an urgent expense is funded by selling investments, this links
-- the expense to the specific sale(s) that covered it (a sale can fund
-- more than one expense, and an expense can be split across sales).
create table if not exists expense_fundings (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  sale_id uuid, -- references sales(id), added as a real FK once sales exists below
  amount_applied numeric(12,2) not null check (amount_applied > 0),
  created_at timestamptz not null default now()
);

-- 5. Sales / capital gains
-- ------------------------------------------------------------
-- Each row in `investments` is already effectively a purchase lot
-- (asset_class, units, purchase_price, purchase_date). A sale closes
-- out (fully or partially) one such lot.
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  holding_id uuid not null references investments(id) on delete cascade,
  units_sold numeric(18,6) not null check (units_sold > 0),
  sale_price numeric(14,4) not null check (sale_price > 0),
  sale_date date not null default current_date,
  proceeds numeric(14,2) not null, -- units_sold * sale_price, minus any charges if tracked
  cost_basis numeric(14,2) not null, -- units_sold * purchase_price of the lot
  gain_amount numeric(14,2) not null, -- proceeds - cost_basis
  holding_period_days int not null,
  gain_type text not null check (gain_type in ('stcg', 'ltcg')),
  tax_rate_pct_used numeric(5,2), -- rate applied at calc time, for audit (rates change)
  tax_estimated numeric(12,2),
  reason text default 'manual' check (reason in ('manual', 'rebalancing', 'urgent_expense')),
  created_at timestamptz not null default now()
);

alter table sales enable row level security;

create policy "sales_owner_only"
  on sales for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table expense_fundings
  add constraint expense_fundings_sale_fk foreign key (sale_id) references sales(id) on delete set null;

alter table expense_fundings enable row level security;

create policy "expense_fundings_owner_only"
  on expense_fundings for all
  using (
    exists (select 1 from expenses e where e.id = expense_id and e.user_id = auth.uid())
  )
  with check (
    exists (select 1 from expenses e where e.id = expense_id and e.user_id = auth.uid())
  );

-- 6. Round-up investing
-- ------------------------------------------------------------
alter table user_settings
  add column if not exists roundup_enabled boolean not null default false;
alter table user_settings
  add column if not exists roundup_nearest numeric(6,2) not null default 10.00; -- round up to nearest ₹10/₹50/₹100
alter table user_settings
  add column if not exists roundup_goal_id uuid references goals(id) on delete set null; -- null = general pool

create table if not exists roundup_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source_expense_id uuid references expenses(id) on delete set null,
  original_amount numeric(12,2) not null,
  rounded_amount numeric(12,2) not null,
  roundup_amount numeric(8,2) not null, -- rounded_amount - original_amount
  status text not null default 'pending' check (status in ('pending', 'invested')),
  created_at timestamptz not null default now()
);

alter table roundup_transactions enable row level security;

create policy "roundup_transactions_owner_only"
  on roundup_transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 7. CAS/CAMS import staging
-- ------------------------------------------------------------
-- Raw imports land here first for the user to review/map before
-- anything touches `investments` — avoids silent duplicates and lets
-- the user confirm asset_class + symbol for each parsed line.
create table if not exists cas_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('cdsl', 'nsdl', 'camsonline', 'karvy_kfintech', 'other')),
  file_name text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'partially_applied', 'applied', 'discarded')),
  imported_at timestamptz not null default now()
);

alter table cas_import_batches enable row level security;

create policy "cas_import_batches_owner_only"
  on cas_import_batches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists cas_import_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references cas_import_batches(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  raw_scheme_name text not null,
  isin text,
  folio_number text,
  units numeric(18,4),
  nav numeric(14,4),
  value numeric(14,2),
  statement_date date,
  suggested_asset_class asset_class, -- best-guess mapping, user confirms/edits
  matched_investment_id uuid references investments(id) on delete set null, -- if it matches an existing holding
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

alter table cas_import_lines enable row level security;

create policy "cas_import_lines_owner_only"
  on cas_import_lines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 8. Variable yearly escalation — user-editable at any time
-- ------------------------------------------------------------
-- investment_plans.escalation_pct (from Phase 1) is already the ongoing
-- default and already user-editable via a normal UPDATE — the planner
-- reads it live whenever an escalation next comes due, so changing it
-- takes effect from the next escalation without any extra plumbing.
-- What Phase 1 didn't have: a one-off override for just the NEXT
-- escalation (e.g. "skip this year"), and a history of what % was
-- actually applied each year, since it's no longer assumed to be a
-- single flat number for the plan's whole lifetime.
alter table investment_plans
  add column if not exists next_escalation_pct_override numeric(5,2);

create table if not exists escalation_log (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references investment_plans(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  applied_date date not null,
  old_monthly_amount numeric(12,2) not null,
  new_monthly_amount numeric(12,2) not null,
  escalation_pct_used numeric(5,2) not null,
  was_override boolean not null default false,
  created_at timestamptz not null default now()
);

alter table escalation_log enable row level security;

create policy "escalation_log_owner_only"
  on escalation_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 10. Telegram webhook idempotency
-- ------------------------------------------------------------
-- Telegram can redeliver the same update (retries, double-taps before
-- the UI visibly updates). Without a record of what's already been
-- processed, a "No" tap could double-apply a rollover, or "Yes" could
-- double-log a confirmation. update_id is Telegram's own per-bot
-- sequence number, unique per update.
create table if not exists processed_telegram_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

-- No RLS — this table is written only by the webhook handler (service
-- role), never read or written by a client session directly.
-- Prune periodically (e.g. delete rows older than 7 days) — Telegram
-- doesn't redeliver indefinitely, so unbounded retention isn't needed.

-- 11. Admin role (for the admin cross-user view — §Reporting)
-- ------------------------------------------------------------
alter table profiles
  add column if not exists is_admin boolean not null default false;

-- The admin dashboard reads through a service-role edge function, not
-- direct client RLS bypass — deliberately not adding a "select all
-- rows if is_admin" policy here, since that would let a compromised
-- client session enumerate every user's holdings. See
-- admin_dashboard.ts for the intended access pattern.
