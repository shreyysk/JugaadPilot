/**
 * JugaadPilot — Telegram webhook security
 *
 * The planner and price-alert modules build Telegram messages, but
 * nothing so far verifies that an incoming webhook call actually came
 * from Telegram, or stops the same button-tap being processed twice.
 * Both matter here specifically because a forged or replayed callback
 * can trigger a real state change: "confirmed_invested" on a month
 * that wasn't, or a duplicate application of a rollover.
 *
 * Pure functions except verifySecretToken, which does a constant-time
 * compare deliberately (see note below) — still no network I/O.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Telegram lets you set a secret token when registering the webhook
 * (setWebhook's secret_token param); Telegram then sends it back on
 * every request as the X-Telegram-Bot-Api-Secret-Token header. Compare
 * it with a constant-time check — a plain `===` leaks timing
 * information about how many leading characters matched, which for a
 * secret that gates financial-state-changing callbacks is worth
 * avoiding even though the practical risk is small.
 *
 * Call this FIRST, before touching the request body at all, in the
 * webhook handler. Reject with 401 on false without processing further.
 */
export function verifySecretToken(
  headerValue: string | null | undefined,
  expectedSecret: string
): boolean {
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}

/**
 * callback_data from buildTelegramCheckinPayload looks like
 * "checkin:yes:<planId>:<periodMonth>". Parsing it out here in one
 * place avoids ad-hoc string-splitting (and the injection-shaped bugs
 * that come from trusting unvalidated shape) at each call site.
 */
export interface ParsedCheckinCallback {
  reply: "yes" | "no";
  planId: string;
  periodMonth: string; // YYYY-MM-DD
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCheckinCallback(callbackData: string): ParsedCheckinCallback | null {
  const parts = callbackData.split(":");
  if (parts.length !== 4 || parts[0] !== "checkin") return null;

  const [, reply, planId, periodMonth] = parts;
  if (reply !== "yes" && reply !== "no") return null;
  if (!UUID_RE.test(planId)) return null;
  if (!DATE_RE.test(periodMonth)) return null;

  return { reply, planId, periodMonth };
}

/**
 * Idempotency guard: Telegram can and does redeliver the same update
 * (network retry, user double-tapping before the button visibly
 * updates) — without this, a "No" tap could apply the rollover amount
 * twice, silently inflating next month's split.
 *
 * The caller passes update_id (Telegram's own per-update sequence
 * number, unique per bot) plus a small persisted set/table of update
 * ids already processed (e.g. a `processed_telegram_updates` table
 * with update_id as primary key and a short retention, or a Redis set
 * with a TTL of a few days — Telegram redelivers within a bounded
 * window, not indefinitely). This function is the pure decision logic;
 * the actual lookup/insert against that store is the caller's job
 * since it's storage-specific.
 */
export function isDuplicateUpdate(
  updateId: number,
  alreadyProcessedIds: ReadonlySet<number>
): boolean {
  return alreadyProcessedIds.has(updateId);
}
