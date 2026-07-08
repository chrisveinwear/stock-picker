/**
 * Single app-wide margin-of-safety convention (per CLAUDE.md): the % discount
 * of the current price to the MIDPOINT of the intrinsic-value range. Positive
 * means the price sits below fair value; ≥ 30 clears the buy hurdle.
 *
 * Every surface that shows or stores an MOS must go through this helper —
 * historically the app mixed three bases (IV high, IV midpoint, single target)
 * and two units (fraction and percent), so the same stock showed +6% on one
 * page and −3% in its own report.
 */
export function midpointIv(
  ivLow: number | null | undefined,
  ivHigh: number | null | undefined
): number | null {
  if (ivLow != null && ivHigh != null) return (ivLow + ivHigh) / 2;
  return ivHigh ?? ivLow ?? null;
}

export function marginOfSafetyPct(
  ivLow: number | null | undefined,
  ivHigh: number | null | undefined,
  price: number | null | undefined
): number | null {
  const mid = midpointIv(ivLow, ivHigh);
  if (mid == null || mid <= 0 || price == null || price <= 0) return null;
  return ((mid - price) / mid) * 100;
}
