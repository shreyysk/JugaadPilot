# JugaadPilot — Master Project Document

*A personal investment tracking and active rebalancing tool, built for personal use and extensible to trusted invited users.*

---

## 1. What This Is

JugaadPilot is a web app for tracking a personal investment portfolio (gold, silver, mutual funds, Indian stocks, US stocks, FD, cash) and getting active, specific rebalancing guidance — not just dashboards, but "buy ₹X of Y" recommendations from an AI chatbot layer sitting on top of a deterministic calculation engine.

It started as a personal tool but is built on the same schema and infrastructure as the broader planned product, so it doubles as Phase 1 of that product, dogfooded by the builder first.

## 2. Scope & Legal Note

This is for the owner's personal use and decisions only, plus a small number of close/trusted people invited in — **it is not offered to others for money.** That distinction is what keeps it outside India's SEBI investment-adviser registration requirement. If this is ever commercialized or sold to third parties, the earlier "informational only" rules from the separate commercial plan apply again, and the advisory framing would need to change.

Because close ones do get personalized buy/sell suggestions (even informally, for free), the app includes a light disclaimer in the chat UI — something like *"This reflects [App]'s calculations based on what you've entered — always use your own judgment"* — to keep it clearly a helpful tool among trusted people, not something that reads as a formal advisory service to an outsider.

## 3. Modules (All Included)

| Module | Description |
|---|---|
| **Portfolio Dashboard** | Tracks gold, silver, mutual funds, Indian stocks, US stocks, FD, cash/savings |
| **Allocation Drift Alerts** | Flags when actual allocation moves away from the target framework |
| **Benchmark Comparison** | Portfolio return vs Nifty 50 and gold price over the same period |
| **Tax/ITR Calculators** | Regime comparison, deduction checklist |
| **GST Tools** | For freelance/invoicing use if that ever comes up |
| **Rebalancing Chatbot** | AI-powered, gives active buy/sell/timing suggestions based on the user's own data |

## 4. Data Model — Per Holding (Full Detail)

Each logged holding tracks:

- Asset class (gold / silver / mutual fund / Indian stock / US stock / FD / cash)
- Name (fund name, stock ticker, etc.)
- Units/quantity
- Purchase price (per unit)
- Purchase date
- Current value (manual or fetched)
- Notes — the owner's own reasoning for buying it, for later review

This supports real gain/loss tracking per holding, not just portfolio totals.

## 5. Charts (All Included)

- **Pie chart** — current allocation across asset classes
- **Line chart** — total net worth / portfolio value over time
- **Bar chart** — portfolio return vs Nifty 50 and gold, side by side, over 1M/6M/1Y

## 6. Target Allocation & Drift

**Target framework (locked in):**

| Asset class | Target % |
|---|---|
| Gold | 60% |
| Silver | 15% |
| Mutual funds | 10% |
| Indian stocks | 5% |
| US stocks | 5% |
| FD | 5% |
| **Total (investable)** | **100%** |
| Cash | Tracked separately — *excluded* from the target/drift calculation |

Cash is deliberately not part of the rebalanced allocation — it's shown on the dashboard for net-worth purposes, but drift and target percentages are computed against the investable portfolio (everything except cash).

**Drift threshold: ±5%** — if a class's actual % strays 5 points or more from its target, it gets flagged.

## 7. Rebalancing Engine — How Recommendations Work

Runs independently per user:

1. Each user sets their own target allocation framework once (their own numbers — not necessarily the same as anyone else's).
2. The system continuously compares that user's actual holdings against their own target.
3. When drift exceeds the threshold, it flags a **specific, actionable move**:
   - **How much** — an exact ₹ amount or unit quantity (e.g. "invest ₹8,000 more")
   - **Which one** — a specific instrument, preferring one the user already holds where possible (e.g. "add to your existing HDFC Gold ETF" rather than a generic "buy gold")
   - If nothing is currently held in the under-allocated class, it suggests a category-appropriate option (e.g. "a Gold ETF or Sovereign Gold Bond") and explains the trade-offs, rather than picking one specific fund arbitrarily

This is a **hybrid calculation**:
- The "how much" is fully deterministic math (no AI needed) — computed from current vs target value.
- The "which specific instrument" is where the chatbot layer adds judgment, referencing the user's existing portfolio and general instrument-selection factors (expense ratio, liquidity, familiarity).

## 8. The Chatbot — Multi-Model, Bring-Your-Own-Key

Since the app is multi-user, the chatbot is designed so the owner's own AI costs stay at zero no matter how many people join:

- Every user connects their own AI API key in their settings.
- **Default:** Google Gemini free tier — works out of the box, no setup required.
- **Optional upgrade:** Claude (or another provider) — anyone who wants sharper reasoning can add their own key, and the app switches to it for their account only.
- The owner's own account can use the owner's Claude API key — no one else's usage touches that billing.
- Each user's chatbot only ever sees that user's own holdings, target framework, and drift alerts — enforced by Row-Level Security.

**Check-in style: daily** — the chatbot proactively checks in daily (in addition to being available on-demand whenever asked).

**Chatbot guidance style:** gives both *how much* to buy and *which specific instrument* to buy — not just asset-class-level nudges.

## 9. Multi-User Design

- This is a web app, so the same access can be given to close ones to build their own profile.
- Each invited person gets a fully isolated profile, holdings, and chatbot history via **Row-Level Security + invite-only allowlist**.
- The owner's account holds admin-level oversight.
- Each invited person sets **their own** target allocation and risk profile — not a shared framework copied from the owner. The rebalancing engine runs independently per person.

## 10. Build Approach

Built as a full app (Supabase + Netlify), not a quick standalone artifact — since the broader company/product infrastructure is already planned, this personal version is effectively **Phase 1 of the real product**, dogfooded by the owner first.

- Same Supabase schema already built for the product: `profiles`, `transactions`, `investments`, `goals`, `audit_log` — the `investments` table already has the fields needed for full holding detail (unit, invested_amount, purchase_date, etc.), plus a new `notes` field.
- Same Netlify frontend approach.
- The chatbot becomes the first real test of the planned LLM orchestration layer, configured for full personalization since it's just the owner using it initially.

## 11. Schema Additions (Phase 1 Update)

- `investments.notes` — free-text field for the owner's own reasoning per holding.
- `target_allocations` — one row per user per asset class, with a trigger enforcing that a user's non-cash percentages sum to exactly 100%.
- `user_settings` — per-user `drift_threshold_pct` (default 5.00), `chatbot_checkin_style` (`daily` / `weekly` / `on_demand` / `daily_and_on_demand`), `ai_provider` (`gemini` / `claude` / `other`), and an encrypted `ai_api_key_ciphertext`.
- All new tables have Row-Level Security enabled, scoped to `auth.uid() = user_id`.

## 12. Deterministic Rebalancing Logic (Phase 1 Update)

A pure calculation module (no AI calls) that:

- Validates a user's target allocation sums to 100% (excluding cash).
- Computes each asset class's current value, current %, target %, and drift %, against the investable portfolio value (total minus cash).
- Flags any class whose drift exceeds the user's threshold.
- Computes the exact ₹ amount to buy or sell to bring that class back to target.
- Returns holdings already held in that class, so the chatbot layer can prefer topping those up over introducing new instruments.

This is the layer the AI chatbot builds on top of — it never has to do the math itself, only the instrument-selection judgment.

## 12a. Fixed Monthly Investment Plan (with Annual Escalation)

Instead of only reacting to drift, the user can set a **fixed monthly amount** to invest, and the app automatically:

1. **Splits it** across asset classes using the same target allocation percentages as the rebalancing engine (cash excluded, since cash isn't part of the investable split).
2. **Increases it every year by a % the user sets** — 10% is just the starting default, not a locked rule. The user can change the ongoing yearly % at any time (takes effect from whichever escalation next comes due), or override just the single upcoming escalation (e.g. skip a year by setting that one to 0%, or bump it higher for one year) without changing their long-term default. Every year's actually-applied % is kept in `escalation_log` for history, since it's no longer assumed to be one flat number for the plan's whole life.

Example: at ₹10,000/month with the 60/15/10/5/5/5 split:

| Asset class | % | Monthly amount |
|---|---|---|
| Gold | 60% | ₹6,000 |
| Silver | 15% | ₹1,500 |
| Mutual funds | 10% | ₹1,000 |
| Indian stocks | 5% | ₹500 |
| US stocks | 5% | ₹500 |
| FD | 5% | ₹500 |

After year 1, the monthly amount auto-escalates (by whatever % is set at that time) to ₹11,000 if left at the 10% default, and re-splits the same way. From there it's entirely up to the user each year — leave it compounding at 10%, dial it up in a good year, set it to 0% to pause the increase, or override just one year without touching the ongoing default.

**How it works technically:**
- `investment_plans` stores the current monthly amount, escalation %, and the next escalation due date.
- `monthly_split_log` records exactly how each month's amount was split, for a running history of "what should I have invested, and where" — separate from `investments`, which records what was *actually* bought (the two are meant to be compared: plan vs actual).
- A scheduled job (daily or monthly) checks each plan's `next_escalation_date` and bumps `monthly_amount` by `escalation_pct` when due, then advances the date by a year.
- The plan setup screen can show a projection ("in 5 years you'll be investing ₹X/month") using the same escalation math.

## 13. Practical "How to Start" Guide — Where and How to Actually Invest

This is app content (an onboarding/help section), not the app's own logic — practical starting points for each asset class as of 2026, written for a first-time investor. **General information only, not personalized financial advice** — rates, platforms, and tax rules below change; verify current terms before acting, and the app should link out to official sources rather than hardcode numbers that go stale.

### Gold
- **Gold ETFs** (via any stockbroker — Zerodha, Groww, Upstox, etc.) are the practical default now: you buy them like a stock, they track gold price closely, and unlike physical gold there's no storage or purity risk.
- **Sovereign Gold Bonds (SGBs)** — historically the most tax-efficient route (interest + tax-free capital gains at maturity) — have had **no new tranches issued since February 2024**, and the Finance Ministry confirmed in the 2025 budget it does not plan to issue more. So SGBs are effectively closed to new investors for now; only buyable second-hand on the exchange (where the tax-free-at-maturity benefit no longer applies from FY 2026-27 onward). Don't build the app's onboarding around SGBs as if they're freely available — check for a relaunch before recommending them.
- **What to log in the app:** asset class `gold`, name (e.g. "Nippon India Gold ETF"), units, purchase price per unit, purchase date.

### Silver
- **Silver ETFs** (launched in India from 2022 onward) via the same brokers as above — buy like a stock.
- Physical silver isn't practical to track for allocation purposes (spreads, purity, storage).
- **What to log:** same fields as gold, asset class `silver`.

### Mutual Funds
- Use a **direct plan** (not "regular"), which skips the distributor commission and has a meaningfully lower expense ratio over time.
- Buy via a direct-plan platform (Groww, Kuvera, Coin by Zerodha) or straight from the AMC's own website/app.
- **What to log:** fund name, units (or NAV-based value if the app doesn't track fractional units), purchase price (NAV on purchase date), purchase date.

### Indian Stocks
- Open a demat + trading account with a discount broker (Zerodha, Groww, Upstox, Angel One) — KYC via PAN, Aadhaar, and bank details, mostly done online now.
- **What to log:** stock ticker/name, units, purchase price per unit, purchase date.

### US Stocks
- Three practical routes:
  1. **Indian platforms with US stock access** (INDmoney, Vested, Groww) — simplest onboarding, fractional shares, but currency-conversion spreads and a smaller stock universe.
  2. **Direct foreign broker** (Interactive Brokers, Charles Schwab) — more paperwork, generally lower ongoing costs, full US market access.
  3. **Indian mutual funds / fund-of-funds** tracking US indices (e.g. a Motilal Oswal S&P 500 fund) — simplest of all, no LRS remittance needed, but you don't hold the US stock directly.
- All direct routes go through the RBI's **Liberalised Remittance Scheme (LRS)** — up to USD 250,000 per person per financial year, routed through an RBI-authorised bank.
- Tax/compliance to be aware of (verify current rules before relying on this): capital gains taxed differently from Indian equities, US dividend withholding tax (reduced under the India-US DTAA, reclaimable via Form 67), and a requirement to disclose foreign assets in Schedule FA of the ITR once holdings cross the reporting threshold.
- **What to log:** ticker, units (fractional allowed), purchase price in ₹ (post-conversion) or USD with the conversion rate noted, purchase date.

### FD (Fixed Deposit)
- Simplest to start: open via your existing bank's net banking, or compare rates across banks using an FD aggregator (e.g. Stable Money, Bajaj Finance FD).
- FD doesn't fit the "units + purchase price" shape the other asset classes use — instead it needs:
  - **Principal amount**
  - **Interest rate** (the schema adds `interest_rate_pct` for this)
  - **Maturity date** (the schema adds `maturity_date` for this)
- **What to log:** bank/issuer name as the "name" field, principal as current value, interest rate, purchase date (deposit date), maturity date.

### Cash
- Just the balance in savings/liquid accounts — logged for the net-worth dashboard, but excluded from the target allocation and drift/rebalancing math (see §6).

## 14. Price Auto-Fetch, Notifications & Price Alerts (Phase 1 Update)

Three more decisions locked in: prices auto-fetch instead of manual entry, alerts go out over Telegram/push (switched from an earlier WhatsApp-based design — Telegram has no per-message fee at all, so it's simpler and free), and month-end confirmation has a real yes/no/rollover flow — plus a separate high-priority engine for buy-dip/sell-target alerts.

### 14.1 Price auto-fetch architecture
- A shared `price_cache` table (one row per asset_class + symbol, **not per user/holding**) is refreshed by a scheduled job — avoids redundant API calls when multiple users hold the same instrument.
- Practical free/cheap data sources for this scale of app:
  - **Indian stocks & ETFs (gold/silver ETFs included):** Yahoo Finance (unofficial, free, ~15 min delayed) using `.NS`/`.BO` ticker suffixes.
  - **Mutual funds:** AMFI's daily NAV file (official, free, no key needed) — `https://www.amfiindia.com/spages/NAVAll.txt`.
  - **US stocks:** Yahoo Finance also covers US tickers directly.
  - **Gold/silver as commodities (if not using ETF price as proxy):** Yahoo Finance futures tickers (`GC=F`, `SI=F`) converted to INR via the `INR=X` FX ticker.
  - All of the above are free tiers/unofficial APIs — expect occasional rate limits or breakage; a paid provider (e.g. Alpha Vantage, Twelve Data) is a fallback if reliability becomes an issue.
- `price_history` keeps a rolling log per symbol (not just the latest value) — needed for the drop%/rise% alert rules in §14.3.
- Each `investments` row gets a new `symbol` field (the ticker/scheme code) separate from the free-text `name`, so the fetch job has a stable lookup key.

### 14.2 Notification delivery — kept at zero cost, now via Telegram
Originally designed around a WhatsApp deep-link workaround to stay free (WhatsApp Business Cloud API only lets a business speak first for free inside a user-opened window, otherwise it's a paid template). **Switched to a Telegram bot instead** — simpler and fully free in both directions, no workaround needed:

- Telegram's Bot API has **no per-message fee at all**, unlike WhatsApp — the bot can message a user first (proactively) for free, as long as the user has sent `/start` to the bot once to begin the chat.
- Setup: create a bot via Telegram's `@BotFather`, get a bot token, and during onboarding each user taps a link that opens a chat with the bot and sends `/start` — the resulting `chat_id` gets stored in `user_settings.telegram_chat_id` and is what the app uses to message them from then on.
- Telegram supports **inline keyboard buttons** natively (Yes/No, etc.) — tapping one fires a webhook callback straight to the app, no free-text parsing needed for the common cases.
- `user_settings.alert_channel`: `telegram` (default), `push`, or `both`.

Net effect: this is simpler than the WhatsApp workaround (no deep links, no "who spoke first" bookkeeping) and still ₹0/month regardless of how many users or messages.

### 14.3 Monthly confirmation, with real rollover
Near month-end, for each active plan:
1. The bot sends a Telegram message: *"Did you invest your ₹X plan for [month]?"* with **Yes / No inline buttons** attached (see `buildTelegramCheckinPayload` in the planner module).
2. **Tap Yes** → that period's `monthly_split_log` rows are marked `confirmed_invested`. Nothing changes for next month.
3. **Tap No** → that period is marked `skipped_rolled_over`, and the **entire skipped amount is added to `investment_plans.rollover_amount`**. Next month's split then uses `monthly_amount + rollover_amount` (not just `monthly_amount`), so the skipped month isn't silently lost — the money is still expected to go in, just later. The rollover clears once it's been folded into a split.

This means a skipped ₹10,000 month turns the following month's split into ₹20,000 (₹10,000 normal + ₹10,000 rolled over), split across asset classes exactly as usual — and none of this costs anything to deliver.

### 14.4 Price alerts — buying dips & selling points
A separate, deterministic rule engine (no AI needed to decide *whether* to fire — only optionally to phrase the message) watches prices and sends **high-priority** alerts:

| Rule type | Fires when | Used for |
|---|---|---|
| `price_drop_pct` | Price falls ≥X% from its recent high (over a lookback window, e.g. 7 days) | Buying-dip opportunities |
| `price_rise_pct` | Price rises ≥X% from its recent low | Worth reviewing whether to book profit |
| `target_price` | Price reaches a specific ₹ level the user set | A concrete selling point the user chose in advance |
| `stop_loss_price` | Price falls to a specific ₹ floor the user set | Downside protection / exit trigger |

Each user sets their own rules per holding or per asset class (`price_alert_rules`), the engine checks them right after each price refresh, and a 24-hour cooldown stops the same rule from spamming repeatedly while a price stays past its threshold. These are flagged as `priority: high` in the `alerts` table, delivered the same zero-cost way as everything else — an immediate free push notification, with a `wa.me` deep link if the user wants to discuss it with the chatbot right away.

## 16. Goals, Loans, Insurance, Expenses & Safer-Sell (Phase 2 Update)

Five more feature groups, chosen from the earlier feature MCQ, layered on top of the Phase 1 schema without disturbing it — see `schema_update_v2.sql`.

### 16.1 Named goals
A `goals` table (name, target amount, optional target date, priority) sits alongside the existing single-pool investment plan. Rather than build a parallel contribution system, a `goal_id` was added to both `investment_plans` and `investments` — a plan can now feed one specific goal, and a holding can be earmarked to one. Progress is a SQL view (`goal_progress`) that sums earmarked holdings' current value plus confirmed monthly contributions for plans tied to that goal, so it's never a stale cached number.

`goal_tracker.ts` adds the pure-calculation layer on top: `projectGoal()` works out whether a goal is on track for its date (assuming no investment growth — a deliberately conservative floor, since assumed returns are a judgment call), and `allocateBudgetAcrossGoals()` splits a limited monthly budget across competing goals by priority (fully funding the highest-priority goal before the next gets anything) rather than spreading thin evenly.

### 16.2 Loan / EMI tracker
`loans` + `loan_payments` tables track liabilities alongside assets — home/car/personal/education/credit-card loans, each with principal, outstanding balance, rate, EMI, and tenure. `loan_insurance_tracker.ts` builds a standard reducing-balance amortization schedule from any point (`buildAmortizationSchedule`), projects the effect of a lump-sum prepayment on tenure and total interest (`projectPrepayment`), and rolls up total outstanding debt (`totalOutstandingDebt`) so the dashboard can show real net worth (assets minus liabilities), not just gross holdings.

### 16.3 Insurance tracker
`insurance_policies` tracks term/health cover — provider, sum assured, premium, frequency, renewal date. The same module normalizes any premium frequency to an annual figure for comparison, flags policies renewing within 30 days, and includes a rough term-cover-adequacy check (sum assured vs a multiple of annual income) — explicitly framed as a sanity flag, not advice, since real adequacy depends on dependents and existing assets the app doesn't fully model.

### 16.4 Expense manager + "safer sell" engine
`expenses` logs day-to-day spending, with an `is_urgent` flag for the case that matters most: *I need ₹X now — what should I sell?* `expense_manager.ts` is where the three earlier engines meet:
- It pulls candidate holdings from the rebalancing engine's drift output.
- Scores each by three factors: **is it already over-allocated** (selling it doubles as a rebalancing move — biggest positive weight), **LTCG vs STCG** (from the capital-gains calculator — long-term beats short-term), and **size of the embedded gain relative to cost basis** (a small/negative gain is safer to realize than a large one).
- Ranks candidates best-first, greedily builds a combination that covers the exact amount needed, and reports the shortfall if even selling everything available isn't enough.
- Every suggestion comes with a plain-language rationale ("gold is over your target allocation, so this also helps rebalance; long-term gain, taxed at 12.5%") rather than just a bare score — the score is for sorting, not a guarantee, per the app's existing "use your own judgment" framing.

A `sales` table records realized sales (proceeds, cost basis, gain, STCG/LTCG classification, estimated tax) and doubles as the data source for the tax calculator below; `expense_fundings` links an expense to the specific sale(s) that covered it.

### 16.5 Capital-gains / tax calculator
`capital_gains_calculator.ts` classifies each sale as STCG or LTCG per the holding period rules for its asset class (12 months for listed equity/equity MFs, 24 months for gold/silver ETFs and US stocks), estimates tax using current flat rates for equity (20% STCG / 12.5% LTCG above the ₹1.25L/year exemption) and non-equity LTCG (12.5%, no indexation), and falls back to a user-supplied income-slab rate for non-equity STCG (gold/silver/US stocks held short-term), since that can't be inferred. `summarizeTaxYear()` nets gains/losses within a tax year for a rough Schedule CG-style summary. **Rates are current as commonly understood for FY2025-26/26-27 and will go stale — the calculator is a starting estimate, not a return, and should carry the same "verify before relying on this" note as the rest of §13.**

### 16.6 Round-up investing
`user_settings` gained `roundup_enabled`, `roundup_nearest` (round to nearest ₹10/₹50/₹100), and `roundup_goal_id`. A `roundup_transactions` table logs each rounded-up expense and whether it's been invested yet — kept as its own small ledger rather than folded into `monthly_split_log`, since round-ups accumulate continuously rather than on a monthly cadence and need their own "invested" flag.

### 16.7 CAS/CAMS import (staging)
`cas_import_batches` + `cas_import_lines` hold raw parsed statement rows (scheme name, ISIN, folio, units, NAV, value) for review before anything touches `investments` — deliberately a staging area, not a direct write, so the user confirms the asset-class mapping and folio-to-holding matching rather than the app guessing silently and creating duplicates. The actual PDF/XML parsing layer for CDSL/NSDL/CAMS/KFintech statements is not yet built — see §17.

## 13. Status / Decisions Log

| Decision | Value |
|---|---|
| Drift threshold | ±5% |
| Chatbot check-in style | Daily (plus on-demand) |
| Target allocation | Gold 60 / Silver 15 / Mutual funds 10 / Indian stocks 5 / US stocks 5 / FD 5 (cash excluded, tracked separately) |
| Default AI provider (invited users) | Gemini free tier |
| Owner's AI provider | Claude, via own API key |
| Scope | Personal + close ones, not sold — stays outside SEBI adviser registration |
| Schema & rebalancing engine (Phase 1 deterministic layer) | Built |
| Fixed monthly investment plan (with 10%/year escalation) | Built |
| Practical "how to start" guide (gold/silver/MF/stocks/US stocks/FD) | Written — see §13 |
| Price auto-fetch, Telegram/push alerts, monthly rollover, price-alert engine | Built — see §14 |
| Goals, loans, insurance, expense manager + safer-sell, capital-gains calculator, round-up, CAS import staging | Built — see §16 |
| Chatbot / instrument-selection layer | Not yet built — next step |
| Streak tracker, backtesting, PDF/Excel export, admin cross-user view, CAS/CAMS file parsing | Not yet built — next step |

## 15. What's Next

Still pending from the original roadmap: the **chatbot/instrument-selection layer** — wiring the AI (Gemini by default, Claude optionally) to consume the deterministic engine's output and produce the "which specific instrument" half of each recommendation, plus turning deterministic alerts into natural-language Telegram/push messages.

## 17. What's Next (Phase 2 remainder)

Not yet built, queued for the next pass:
- **Investing streak / consistency tracker** — derivable from `monthly_split_log.status = 'confirmed_invested'` streaks; needs a small pure function plus a display component.
- **Backtest engine** — simulate the locked-in 60/15/10/5/5/5 allocation (or any user-entered allocation) against historical gold/silver/Nifty/US-index price series over a chosen window.
- **Monthly PDF/Excel statement export** — render the dashboard's numbers (holdings, drift, monthly split, realized gains) into a downloadable file.
- **Admin cross-user view** — a service-role-only dashboard for the owner to see all invited users' portfolios at a glance, deliberately NOT exposed via a client-side RLS policy (see the note in `schema_update_v2.sql` §8) to avoid a compromised session enumerating everyone's data.
- **CAS/CAMS/CDSL/NSDL file parsing** — the actual PDF/XML parser that populates `cas_import_lines` from an uploaded statement; the staging schema is ready, the parser isn't written yet.
