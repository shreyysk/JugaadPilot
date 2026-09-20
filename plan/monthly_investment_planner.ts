/**
 * JugaadPilot — fixed monthly investment plan
 *
 * Lets a user set a fixed ₹ amount to invest every month. That amount is
 * split across their target allocation (same percentages used by the
 * rebalancing engine, cash excluded), and auto-increases by a fixed %
 * (default 10%) every year from the plan's start date.
 *
 * Pure functions — no I/O, no AI calls. Deterministic, same as the
 * rebalancing engine in rebalancing_engine.ts.
 */

import type { AssetClass, TargetAllocation } from "./rebalancing_engine";
import { validateTargetAllocation } from "./rebalancing_engine";

export interface InvestmentPlan {
  id: string;
  userId: string;
  monthlyAmount: number;
  rolloverAmount?: number; // carried forward from a skipped month
  escalationPct: number; // default 10 — the ONGOING yearly increment, user-editable anytime
  nextEscalationPctOverride?: number; // one-off % for just the next escalation; doesn't change escalationPct going forward
  startDate: string; // ISO date
  lastEscalationDate: string; // ISO date
  nextEscalationDate: string; // ISO date
  isActive: boolean;
}

export interface EscalationLogEntry {
  planId: string;
  appliedDate: string; // ISO date
  oldMonthlyAmount: number;
  newMonthlyAmount: number;
  escalationPctUsed: number;
  wasOverride: boolean;
}

export interface MonthlySplitLine {
  assetClass: AssetClass;
  splitAmount: number;
}

export interface MonthlySplitResult {
  periodMonth: string; // first day of the month, ISO date
  monthlyAmountUsed: number;
  lines: MonthlySplitLine[];
}

/**
 * Splits a plan's currently-available amount (monthly_amount plus any
 * rolled-over amount from a skipped month, see effectiveMonthlyAmount)
 * across asset classes using the user's target allocation percentages
 * (cash is excluded — same rule as the rebalancing engine, since cash
 * isn't part of the investable split).
 */
export function computeMonthlySplit(
  plan: InvestmentPlan,
  targets: TargetAllocation[],
  periodMonth: Date = new Date()
): MonthlySplitResult {
  const { valid, total } = validateTargetAllocation(targets);
  if (!valid) {
    throw new Error(
      `Target allocation must sum to 100% (excluding cash), got ${total}%.`
    );
  }

  const amountToSplit = effectiveMonthlyAmount(plan);
  const investableTargets = targets.filter((t) => t.assetClass !== "cash");

  const lines: MonthlySplitLine[] = investableTargets.map((t) => ({
    assetClass: t.assetClass,
    splitAmount:
      Math.round(((amountToSplit * t.targetPercentage) / 100) * 100) / 100,
  }));

  const firstOfMonth = new Date(
    Date.UTC(periodMonth.getUTCFullYear(), periodMonth.getUTCMonth(), 1)
  );

  return {
    periodMonth: firstOfMonth.toISOString().slice(0, 10),
    monthlyAmountUsed: amountToSplit,
    lines,
  };
}

/**
 * Checks whether a plan's monthly amount is due for its annual escalation
 * (based on nextEscalationDate) and, if so, returns the updated plan
 * fields to persist. Call this on a daily/monthly scheduled job — it's a
 * pure calculation, the caller is responsible for writing the result back
 * to investment_plans (and appending the returned logEntry to
 * escalation_log for history, since the % applied can differ every year).
 *
 * The % actually used is, in priority order:
 * 1. plan.nextEscalationPctOverride, if the user set one for just this
 *    upcoming escalation (cleared after use — it's a one-off, not a new
 *    ongoing default).
 * 2. plan.escalationPct — the ongoing default, which the user can change
 *    at any time via setEscalationPct() and it takes effect at whichever
 *    escalation next comes due, live, with no need to touch this function.
 *
 * This means the yearly increment is never hard-locked to a single value:
 * the user can leave it at a flat default (e.g. 10% every year), override
 * one specific year (e.g. skip it — set the override to 0 — after an
 * expensive year), or change the ongoing default whenever their income or
 * plans change, and every year's actual applied % is preserved in the
 * returned log entry rather than silently overwritten.
 */
export function applyEscalationIfDue(
  plan: InvestmentPlan,
  asOf: Date = new Date()
): { escalated: boolean; updatedPlan: InvestmentPlan; logEntry: EscalationLogEntry | null } {
  const nextEscalation = new Date(plan.nextEscalationDate);

  if (asOf < nextEscalation) {
    return { escalated: false, updatedPlan: plan, logEntry: null };
  }

  const wasOverride = plan.nextEscalationPctOverride !== undefined;
  const pctUsed = wasOverride ? plan.nextEscalationPctOverride! : plan.escalationPct;

  const newMonthlyAmount =
    Math.round(plan.monthlyAmount * (1 + pctUsed / 100) * 100) / 100;

  const newLastEscalationDate = asOf.toISOString().slice(0, 10);
  const newNextEscalationDate = addOneYear(asOf).toISOString().slice(0, 10);

  const updatedPlan: InvestmentPlan = {
    ...plan,
    monthlyAmount: newMonthlyAmount,
    lastEscalationDate: newLastEscalationDate,
    nextEscalationDate: newNextEscalationDate,
  };
  // A one-off override is spent once it's applied — clear it so the
  // FOLLOWING year falls back to the ongoing escalationPct default
  // unless the user sets a new override for that year specifically.
  delete updatedPlan.nextEscalationPctOverride;

  return {
    escalated: true,
    updatedPlan,
    logEntry: {
      planId: plan.id,
      appliedDate: newLastEscalationDate,
      oldMonthlyAmount: plan.monthlyAmount,
      newMonthlyAmount,
      escalationPctUsed: pctUsed,
      wasOverride,
    },
  };
}

/**
 * Updates the plan's ongoing yearly escalation default. Takes effect
 * from the NEXT time an escalation is due — doesn't retroactively touch
 * monthly_amount, and doesn't require the user to wait for a fixed
 * "review window"; they can change their mind as often as they like.
 * Pass 0 to stop auto-escalating altogether without deactivating the plan.
 */
export function setEscalationPct(plan: InvestmentPlan, newPct: number): InvestmentPlan {
  if (newPct < 0) throw new Error("escalationPct cannot be negative.");
  return { ...plan, escalationPct: newPct };
}

/**
 * Sets a one-time % to use for just the upcoming escalation (e.g. "skip
 * this year, apply 0%" or "bump it 15% just this once"), without
 * changing the plan's ongoing default. Cleared automatically once that
 * escalation fires — see applyEscalationIfDue.
 */
export function setNextEscalationOverride(
  plan: InvestmentPlan,
  overridePct: number
): InvestmentPlan {
  if (overridePct < 0) throw new Error("overridePct cannot be negative.");
  return { ...plan, nextEscalationPctOverride: overridePct };
}

/**
 * Clears a pending one-time override, reverting the upcoming escalation
 * to the plan's ongoing default — for when the user changes their mind
 * back before the escalation date arrives.
 */
export function clearNextEscalationOverride(plan: InvestmentPlan): InvestmentPlan {
  const updated = { ...plan };
  delete updated.nextEscalationPctOverride;
  return updated;
}

/**
 * Projects the monthly amount forward N years, applying the escalation
 * once per year — useful for showing "in 5 years you'll be investing
 * ₹X/month" on the plan setup screen.
 *
 * This assumes the CURRENT escalationPct holds constant for every future
 * year — a necessary simplification, since the user can change the %
 * (or set a one-off override) at any point between now and then, which
 * this function has no way to know in advance. Treat it as a projection
 * under today's settings, not a promise.
 */
export function projectMonthlyAmount(
  plan: InvestmentPlan,
  yearsAhead: number
): number {
  let amount = plan.monthlyAmount;
  for (let i = 0; i < yearsAhead; i++) {
    amount = Math.round(amount * (1 + plan.escalationPct / 100) * 100) / 100;
  }
  return amount;
}

/**
 * Applies the outcome of the month-end check-in ("did you invest this
 * month?", answered via a Telegram inline-button reply) to a plan.
 *
 * - "yes" -> that period is marked confirmed_invested, nothing carries
 *   forward, next month uses the plan's normal monthly_amount.
 * - "no"  -> that period is marked skipped_rolled_over, and its full
 *   monthly_amount is added to the plan's rollover_amount, so next
 *   month's split is bigger by exactly the skipped amount.
 *
 * Pure function — the caller persists updatedPlan and the log status.
 */
export function applyMonthlyConfirmation(
  plan: InvestmentPlan,
  reply: "yes" | "no",
  skippedAmount: number
): { updatedPlan: InvestmentPlan; logStatus: "confirmed_invested" | "skipped_rolled_over" } {
  if (reply === "yes") {
    return { updatedPlan: plan, logStatus: "confirmed_invested" };
  }

  return {
    updatedPlan: {
      ...plan,
      rolloverAmount: (plan.rolloverAmount ?? 0) + skippedAmount,
    },
    logStatus: "skipped_rolled_over",
  };
}

/**
 * The amount actually available to split next month — the plan's normal
 * monthly_amount plus anything rolled over from a skipped month. Call this
 * instead of using plan.monthlyAmount directly wherever a split is computed.
 */
export function effectiveMonthlyAmount(plan: InvestmentPlan): number {
  return plan.monthlyAmount + (plan.rolloverAmount ?? 0);
}

/**
 * After a rollover amount has been folded into a month's split (i.e. once
 * computeMonthlySplit has run for that period using effectiveMonthlyAmount),
 * clear it so it isn't counted twice the following month.
 */
export function clearRolloverAfterUse(plan: InvestmentPlan): InvestmentPlan {
  return { ...plan, rolloverAmount: 0 };
}

/**
 * Builds the check-in message text for a given period — a plain yes/no
 * confirmation. Sent via the Telegram Bot API with two inline keyboard
 * buttons ("Yes" / "No") attached; this just produces the deterministic
 * text content, the messaging layer attaches the buttons.
 */
export function buildMonthlyCheckinMessage(
  periodMonth: string,
  amount: number
): string {
  const formatted = amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  return `Did you invest your ${formatted} plan for ${periodMonth}? Tap Yes if done, or No to roll it into next month.`;
}

/**
 * Builds the request body for Telegram's sendMessage API call with an
 * inline "Yes / No" keyboard attached. Telegram's Bot API has no
 * per-message fee, and — unlike WhatsApp Business Cloud API — the bot can
 * message a user directly (once they've sent /start once) without needing
 * the user to open the conversation first. callback_data is what the
 * webhook receives back when a button is tapped; encode enough there
 * (plan id + period) to route the reply without a DB lookup first.
 */
export function buildTelegramCheckinPayload(
  chatId: string,
  messageText: string,
  planId: string,
  periodMonth: string
): {
  chat_id: string;
  text: string;
  reply_markup: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
} {
  return {
    chat_id: chatId,
    text: messageText,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Yes, invested", callback_data: `checkin:yes:${planId}:${periodMonth}` },
          { text: "❌ No, roll it over", callback_data: `checkin:no:${planId}:${periodMonth}` },
        ],
      ],
    },
  };
}

function addOneYear(date: Date): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

