/**
 * JugaadPilot — deterministic rebalancing engine
 *
 * This layer does NOT call the chatbot/AI. It computes, from a user's
 * holdings and their target_allocations row, exactly how far each asset
 * class has drifted and the ₹ amount needed to correct it. The chatbot
 * layer (Phase 5) takes this output and adds the "which specific
 * instrument" judgment on top.
 *
 * Runs independently per user — pass in one user's holdings/targets/
 * settings at a time.
 */

export type AssetClass =
  | "gold"
  | "silver"
  | "mutual_fund"
  | "indian_stock"
  | "us_stock"
  | "fd"
  | "cash";

export interface Holding {
  id: string;
  assetClass: AssetClass;
  name: string;
  units: number;
  purchasePrice: number; // per unit
  currentValue: number; // total current value for this holding
  purchaseDate: string; // ISO date
  notes?: string;
}

export interface TargetAllocation {
  assetClass: AssetClass;
  targetPercentage: number; // 0-100, all rows for a user must sum to 100
}

export interface UserSettings {
  driftThresholdPct: number; // e.g. 5
}

export interface AssetClassSummary {
  assetClass: AssetClass;
  currentValue: number;
  currentPercentage: number;
  targetPercentage: number;
  driftPercentage: number; // currentPercentage - targetPercentage
  isFlagged: boolean;
  action: "buy" | "sell" | "hold";
  amountToRebalance: number; // ₹ amount to buy (+) or sell (-) to hit target exactly
  existingHoldingsInClass: Holding[]; // for the chatbot layer to pick from
}

export interface RebalancingResult {
  totalPortfolioValue: number; // everything, including cash
  investablePortfolioValue: number; // total minus cash — what drift % is computed against
  cashValue: number;
  asOf: string;
  summaries: AssetClassSummary[]; // excludes cash — see cashValue above
  flaggedCount: number;
}

const NON_INVESTABLE_CLASSES: ReadonlySet<AssetClass> = new Set(["cash"]);

/**
 * Validates that a user's target allocation rows sum to 100%, excluding
 * cash — cash is tracked for net worth but isn't part of the rebalanced
 * allocation. Mirrors the check_target_allocation_sums_to_100 DB trigger.
 */
export function validateTargetAllocation(
  targets: TargetAllocation[]
): { valid: boolean; total: number } {
  const total = targets
    .filter((t) => !NON_INVESTABLE_CLASSES.has(t.assetClass))
    .reduce((sum, t) => sum + t.targetPercentage, 0);
  // Allow small floating point slack
  return { valid: Math.abs(total - 100) < 0.01, total };
}

/**
 * Core deterministic calculation. Pure function — no I/O, no AI calls.
 */
export function computeRebalancing(
  holdings: Holding[],
  targets: TargetAllocation[],
  settings: UserSettings
): RebalancingResult {
  const { valid, total } = validateTargetAllocation(targets);
  if (!valid) {
    throw new Error(
      `Target allocation must sum to 100%, got ${total}%. Fix target_allocations before rebalancing.`
    );
  }

  const totalPortfolioValue = holdings.reduce(
    (sum, h) => sum + h.currentValue,
    0
  );
  const cashValue = holdings
    .filter((h) => NON_INVESTABLE_CLASSES.has(h.assetClass))
    .reduce((sum, h) => sum + h.currentValue, 0);
  const investablePortfolioValue = totalPortfolioValue - cashValue;

  const targetByClass = new Map(
    targets.map((t) => [t.assetClass, t.targetPercentage])
  );

  const holdingsByClass = new Map<AssetClass, Holding[]>();
  for (const h of holdings) {
    const list = holdingsByClass.get(h.assetClass) ?? [];
    list.push(h);
    holdingsByClass.set(h.assetClass, list);
  }

  const allClasses = new Set<AssetClass>(
    [...targetByClass.keys(), ...holdingsByClass.keys()].filter(
      (c) => !NON_INVESTABLE_CLASSES.has(c)
    )
  );

  const summaries: AssetClassSummary[] = [];

  for (const assetClass of allClasses) {
    const classHoldings = holdingsByClass.get(assetClass) ?? [];
    const currentValue = classHoldings.reduce(
      (sum, h) => sum + h.currentValue,
      0
    );
    // Percentages are computed against the investable total (excludes cash),
    // matching how target_allocations are validated to sum to 100.
    const currentPercentage =
      investablePortfolioValue > 0
        ? (currentValue / investablePortfolioValue) * 100
        : 0;
    const targetPercentage = targetByClass.get(assetClass) ?? 0;
    const driftPercentage = currentPercentage - targetPercentage;
    const isFlagged = Math.abs(driftPercentage) >= settings.driftThresholdPct;

    // ₹ amount to buy/sell to bring this class exactly to target,
    // relative to the investable portfolio value (cash excluded).
    const targetValue = (targetPercentage / 100) * investablePortfolioValue;
    const amountToRebalance = targetValue - currentValue;

    let action: "buy" | "sell" | "hold" = "hold";
    if (isFlagged) {
      action = amountToRebalance > 0 ? "buy" : "sell";
    }

    summaries.push({
      assetClass,
      currentValue,
      currentPercentage,
      targetPercentage,
      driftPercentage,
      isFlagged,
      action,
      amountToRebalance,
      existingHoldingsInClass: classHoldings,
    });
  }

  // Largest drift first — most urgent action at the top
  summaries.sort(
    (a, b) => Math.abs(b.driftPercentage) - Math.abs(a.driftPercentage)
  );

  return {
    totalPortfolioValue,
    investablePortfolioValue,
    cashValue,
    asOf: new Date().toISOString(),
    summaries,
    flaggedCount: summaries.filter((s) => s.isFlagged).length,
  };
}

/**
 * Formats a flagged summary into the "how much" half of a recommendation
 * (the deterministic part). The chatbot layer appends "which instrument".
 * Example: "Buy ₹8,240 worth of gold (drifted -6.1% below target)"
 */
export function formatDeterministicRecommendation(
  summary: AssetClassSummary
): string {
  const verb = summary.action === "buy" ? "Buy" : "Sell";
  const amount = Math.abs(summary.amountToRebalance).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  const driftDir = summary.driftPercentage < 0 ? "below" : "above";
  return `${verb} ${amount} worth of ${summary.assetClass.replace(
    "_",
    " "
  )} (drifted ${Math.abs(summary.driftPercentage).toFixed(
    1
  )}% ${driftDir} target)`;
}
