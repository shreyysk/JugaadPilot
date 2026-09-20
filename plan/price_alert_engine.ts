/**
 * JugaadPilot — price alert engine
 *
 * Evaluates a user's price_alert_rules against price_cache/price_history
 * and produces high-priority alerts for buying dips or selling targets.
 * Purely deterministic threshold math — no AI call needed for "should
 * this fire", only for the optional narrative text sent to the user.
 *
 * Runs on a scheduled job right after price_cache is refreshed.
 */

import type { AssetClass } from "./rebalancing_engine";

export type RuleType =
  | "price_drop_pct"
  | "price_rise_pct"
  | "target_price"
  | "stop_loss_price";

export interface PriceAlertRule {
  id: string;
  userId: string;
  holdingId: string | null; // null = applies to the whole asset class
  assetClass: AssetClass;
  ruleType: RuleType;
  thresholdValue: number; // % for drop/rise, ₹ for target/stop_loss
  lookbackDays: number;
  isActive: boolean;
  lastTriggeredAt: string | null;
}

export interface PricePoint {
  symbol: string;
  price: number;
  recordedAt: string; // ISO datetime
}

export interface TriggeredAlert {
  ruleId: string;
  userId: string;
  assetClass: AssetClass;
  alertType: "price_opportunity" | "sell_signal";
  priority: "high";
  message: string;
  currentPrice: number;
  referencePrice: number; // the lookback/target/stop price it was compared against
}

const RE_TRIGGER_COOLDOWN_HOURS = 24;

/**
 * Evaluates one rule against a symbol's current price and its recent
 * history (for drop%/rise% rules). Returns a TriggeredAlert if the rule
 * fires, or null if it doesn't (or is in cooldown / has no data yet).
 */
export function evaluateRule(
  rule: PriceAlertRule,
  symbol: string,
  currentPrice: number,
  history: PricePoint[],
  now: Date = new Date()
): TriggeredAlert | null {
  if (!rule.isActive) return null;

  if (rule.lastTriggeredAt) {
    const hoursSinceLastTrigger =
      (now.getTime() - new Date(rule.lastTriggeredAt).getTime()) /
      (1000 * 60 * 60);
    if (hoursSinceLastTrigger < RE_TRIGGER_COOLDOWN_HOURS) return null;
  }

  switch (rule.ruleType) {
    case "price_drop_pct":
    case "price_rise_pct": {
      const cutoff = new Date(
        now.getTime() - rule.lookbackDays * 24 * 60 * 60 * 1000
      );
      const inWindow = history
        .filter((p) => p.symbol === symbol && new Date(p.recordedAt) >= cutoff)
        .sort((a, b) => a.price - b.price);

      if (inWindow.length === 0) return null;

      const referencePrice =
        rule.ruleType === "price_drop_pct"
          ? inWindow[inWindow.length - 1].price // highest in window
          : inWindow[0].price; // lowest in window

      const changePct = ((currentPrice - referencePrice) / referencePrice) * 100;

      if (rule.ruleType === "price_drop_pct" && changePct <= -rule.thresholdValue) {
        return {
          ruleId: rule.id,
          userId: rule.userId,
          assetClass: rule.assetClass,
          alertType: "price_opportunity",
          priority: "high",
          message: `${symbol} is down ${Math.abs(changePct).toFixed(
            1
          )}% over the last ${rule.lookbackDays} days (₹${referencePrice.toFixed(
            2
          )} → ₹${currentPrice.toFixed(2)}) — possible buying opportunity.`,
          currentPrice,
          referencePrice,
        };
      }

      if (rule.ruleType === "price_rise_pct" && changePct >= rule.thresholdValue) {
        return {
          ruleId: rule.id,
          userId: rule.userId,
          assetClass: rule.assetClass,
          alertType: "sell_signal",
          priority: "high",
          message: `${symbol} is up ${changePct.toFixed(
            1
          )}% over the last ${rule.lookbackDays} days (₹${referencePrice.toFixed(
            2
          )} → ₹${currentPrice.toFixed(2)}) — worth reviewing whether to book profit.`,
          currentPrice,
          referencePrice,
        };
      }

      return null;
    }

    case "target_price": {
      if (currentPrice < rule.thresholdValue) return null;
      return {
        ruleId: rule.id,
        userId: rule.userId,
        assetClass: rule.assetClass,
        alertType: "sell_signal",
        priority: "high",
        message: `${symbol} has hit your target of ₹${rule.thresholdValue.toFixed(
          2
        )} (now ₹${currentPrice.toFixed(2)}) — your selling point.`,
        currentPrice,
        referencePrice: rule.thresholdValue,
      };
    }

    case "stop_loss_price": {
      if (currentPrice > rule.thresholdValue) return null;
      return {
        ruleId: rule.id,
        userId: rule.userId,
        assetClass: rule.assetClass,
        alertType: "sell_signal",
        priority: "high",
        message: `${symbol} has dropped to your stop-loss of ₹${rule.thresholdValue.toFixed(
          2
        )} (now ₹${currentPrice.toFixed(2)}) — review whether to exit.`,
        currentPrice,
        referencePrice: rule.thresholdValue,
      };
    }

    default:
      return null;
  }
}

/**
 * Evaluates every active rule for a user against the latest price data.
 * Call this once per scheduled run, after price_cache/price_history are
 * refreshed, with all of that user's rules and the relevant price data.
 */
export function evaluateAllRules(
  rules: PriceAlertRule[],
  latestPrices: Map<string, number>, // symbol -> current price
  history: PricePoint[],
  now: Date = new Date()
): TriggeredAlert[] {
  const triggered: TriggeredAlert[] = [];

  for (const rule of rules) {
    // The caller supplies the symbol via latestPrices keyed by holding's
    // symbol; for an asset-class-wide rule (holdingId is null) the caller
    // is expected to run this per relevant symbol in that class instead.
    for (const [symbol, price] of latestPrices) {
      const result = evaluateRule(rule, symbol, price, history, now);
      if (result) triggered.push(result);
    }
  }

  return triggered;
}
