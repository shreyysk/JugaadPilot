# JugaadPilot — 30-Day Build Roadmap (starting Mon, Sept 21, 2026)

Assumes: all files from this chat (`schema_update.sql`, `schema_update_v2.sql`, `rebalancing_engine.ts`, `monthly_investment_planner.ts`, `price_alert_engine.ts`, `capital_gains_calculator.ts`, `goal_tracker.ts`, `loan_insurance_tracker.ts`, `expense_manager.ts`, `telegram_webhook_security.ts`, `SECURITY_AND_UX_NOTES.md`, `JugaadPilot_Master_Document.md`) are sitting in a `plan/` folder inside your project repo. You're a beginner, so every row with a 🔴 in the "Manual step" column is something **you** do by hand — the AI agent should stop and walk you through it, not attempt it itself.

## Week 1 — Foundations (accounts, schema, first working screen)

| Day | Date | Focus | Key tasks | Manual step |
|---|---|---|---|---|
| 1 | Mon Sep 21 | Accounts & tools | Install Cursor or Antigravity, create a GitHub repo, create a Supabase project, create a Netlify account | 🔴 All four — the agent should guide you through each dashboard screen-by-screen |
| 2 | Tue Sep 22 | Bot + project scaffold | Create the Telegram bot via @BotFather, get the bot token; agent scaffolds the app (Next.js or Vite + Supabase client) | 🔴 BotFather chat is manual (it's a Telegram conversation, no API for this step) |
| 3 | Wed Sep 23 | Database live | Run `schema_update.sql` then `schema_update_v2.sql` in the Supabase SQL editor, verify all tables exist | 🔴 Pasting/running SQL in the Supabase dashboard, checking the Table Editor |
| 4 | Thu Sep 24 | Auth | Wire Supabase Auth (email/password or magic link) into the app; agent codes the login/signup screens | 🔴 Enabling the auth provider + setting redirect URLs in Supabase dashboard |
| 5 | Fri Sep 25 | Portfolio Dashboard | Holdings CRUD screen (add/edit a gold/stock/FD holding), backed by `investments` table | — |
| 6 | Sat Sep 26 | Rebalancing engine wired in | Wire `rebalancing_engine.ts` to real holdings; show drift/flag UI on the dashboard | — |
| 7 | Sun Sep 27 | Buffer / review | Fix bugs from days 1-6, re-read what got built so far | — |

## Week 2 — Automation core (money moving on autopilot)

| Day | Date | Focus | Key tasks | Manual step |
|---|---|---|---|---|
| 8 | Mon Sep 28 | Monthly plan UI | Plan setup screen; wire `monthly_investment_planner.ts`; add the variable/override escalation UI | — |
| 9 | Tue Sep 29 | Price auto-fetch | Scheduled job pulling Yahoo Finance / AMFI NAV into `price_cache`/`price_history` | 🔴 Setting up a Supabase Edge Function cron or Netlify scheduled function in the dashboard |
| 10 | Wed Sep 30 | Telegram webhook, live | Deploy the webhook handler; wire `telegram_webhook_security.ts` (secret token + idempotency) | 🔴 Calling Telegram's `setWebhook` with your secret, pasting the deployed function URL |
| 11 | Thu Oct 1 | Price alerts end-to-end | Wire `price_alert_engine.ts`; test a real buy-dip/target alert reaching your phone via Telegram | 🔴 Sending `/start` to your own bot from your phone to register `chat_id` |
| 12 | Fri Oct 2 | Monthly check-in flow | Test the Yes/No confirm-invested button end-to-end, including a rollover case | — |
| 13 | Sat Oct 3 | Buffer | Fix bugs | — |
| 14 | Sun Oct 4 | Buffer / rest | Catch-up day | — |

## Week 3 — Phase 2 features (goals, loans, insurance, expenses)

| Day | Date | Focus | Key tasks | Manual step |
|---|---|---|---|---|
| 15 | Mon Oct 5 | Goals | Goals screen + `goal_tracker.ts` (progress, on-track projection) | — |
| 16 | Tue Oct 6 | Loans/EMI | Loan tracker screen + `loan_insurance_tracker.ts` amortization view | — |
| 17 | Wed Oct 7 | Insurance | Insurance tracker screen + renewal-reminder alert | — |
| 18 | Thu Oct 8 | Expense manager + safer-sell | Expense log screen; urgent-expense flow using `expense_manager.ts` — **two-tap confirm, never auto-sell** | — |
| 19 | Fri Oct 9 | Capital gains | Wire `capital_gains_calculator.ts`; tax-year summary screen | — |
| 20 | Sat Oct 10 | Round-up investing | Round-up toggle + ledger screen | — |
| 21 | Sun Oct 11 | Buffer + re-audit | Re-check RLS on every new table with two separate test accounts (confirm one user can't see another's data) | — |

## Week 4 — Remaining features, chatbot, and going live

| Day | Date | Focus | Key tasks | Manual step |
|---|---|---|---|---|
| 22 | Mon Oct 12 | Streak tracker | Consistency-streak calculation + display | — |
| 23 | Tue Oct 13 | Backtest engine | Historical allocation backtest against Nifty/gold/silver series | 🔴 Sourcing a historical price CSV (e.g. from Yahoo Finance's own download, or NSE/AMFI archives) |
| 24 | Wed Oct 14 | PDF/Excel export | Monthly statement export | — |
| 25 | Thu Oct 15 | CAS/CAMS import | Statement parser feeding the `cas_import_lines` staging table | 🔴 Getting a real (or dummy) CAS PDF to test with — these are usually PAN-password-protected, handle the password prompt carefully |
| 26 | Fri Oct 16 | Admin view | Cross-user dashboard behind the service role, with its own access log | 🔴 Setting your own `profiles.is_admin = true` row directly in Supabase, and setting the service-role key as a server-only env var (never client-exposed) |
| 27 | Sat Oct 17 | Chatbot layer | Wire Gemini (default) + your own Claude key for the instrument-selection layer | 🔴 Getting a free Gemini API key, storing your Claude key encrypted (not plaintext) in `user_settings` |
| 28 | Sun Oct 18 | Buffer | Fix bugs from week 4 | — |
| 29 | Mon Oct 19 | Full QA + security re-check | Walk every item in `SECURITY_AND_UX_NOTES.md` again against the finished app | — |
| 30 | Tue Oct 20 | Go live | Deploy to production Netlify, invite your first trusted user | 🔴 Netlify production deploy click-through, sending the first invite link |

---

# The prompt to paste into Antigravity / Cursor

Paste this as your first message to the agent, with the `plan/` folder (containing all the files above) already added to the project/workspace so the agent can read them.

```
You are building JugaadPilot, a personal investment-tracking and rebalancing
app, from the design already written in the plan/ folder in this repo.
Before doing anything else, read every file in plan/ in this order:
plan/JugaadPilot_Master_Document.md, plan/schema_update.sql,
plan/schema_update_v2.sql, plan/rebalancing_engine.ts,
plan/monthly_investment_planner.ts, plan/price_alert_engine.ts,
plan/capital_gains_calculator.ts, plan/goal_tracker.ts,
plan/loan_insurance_tracker.ts, plan/expense_manager.ts,
plan/telegram_webhook_security.ts, plan/SECURITY_AND_UX_NOTES.md.
These are the source of truth for the schema, business logic, and known
security/UX requirements — don't redesign them, wire them into a real app
(Next.js or Vite + Supabase + Netlify).

I am a complete beginner at deploying/configuring infrastructure. Follow
these rules for the whole project, every day, no exceptions:

1. STOP AND ASK before any step that needs something only I can do —
   creating an account, generating an API key or token, running SQL in a
   dashboard, setting an environment variable, configuring a webhook,
   enabling an auth provider, deploying, or anything involving real money
   or a real external service. Do not guess, simulate, or skip past these
   steps. Do not proceed to the next task until I confirm the manual step
   is done.

2. When you stop for a manual step, give me FULL beginner-level guidance:
   the exact website/dashboard to open, the exact menu or button names,
   what the screen should look like, and what to paste where. Assume I
   have never done this before — don't say "set up your Supabase project",
   say "go to supabase.com, click New Project, name it X, choose a region
   near India, click Create, then open Project Settings > API and copy the
   two values labeled Y and Z".

3. Never write a secret, API key, or token directly into a file that could
   be committed to git. Always use environment variables, and tell me
   explicitly which .env file to add it to and to add that file to
   .gitignore if it isn't already there.

4. Work in the order of the roadmap I'm giving you below, one day/task at
   a time. After finishing each day's task, tell me plainly what changed,
   show me how to test it myself, and wait for me to say "continue" before
   starting the next one — don't chain multiple days together
   unsupervised.

5. Respect the security and UX notes in plan/SECURITY_AND_UX_NOTES.md as
   hard constraints, not suggestions — especially: the safer-sell engine
   must never execute a trade automatically (suggestion + separate
   explicit confirmation only), the Telegram webhook must verify the
   secret token and check idempotency before acting on any callback, and
   RLS must be tested with two separate accounts before you consider a
   feature "done".

6. If you're ever unsure whether something needs my manual involvement,
   default to asking rather than assuming you can do it yourself.

Here is the 30-day roadmap to follow, one row at a time:

[paste the roadmap table from ROADMAP_AND_BUILD_PROMPT.md here]

Start with Day 1 now: tell me what to do first, one step at a time.
```

A few notes on using this:
- Antigravity and Cursor both let you drop a folder into context — make sure `plan/` is actually inside the repo/workspace you open in the tool, not just referenced by path, or the agent won't be able to read the files.
- If the agent ever starts doing a 🔴 manual step itself (e.g. trying to call an API that needs a key it doesn't have), stop it and re-paste rule 1 — agents sometimes "helpfully" try to work around a missing credential instead of asking for it.
- Keep this roadmap file itself in `plan/` too, so the agent can re-check "which day are we on" without you re-pasting it every session.
