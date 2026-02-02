import { clamp } from "../utils.js";

/**
 * Compute edge for Kalshi markets
 * Note: Kalshi uses YES/NO contracts (similar to Polymarket's UP/DOWN)
 * YES = Bitcoin will be higher at hour close
 * NO = Bitcoin will be lower at hour close
 */
export function computeEdge({ modelUp, modelDown, marketYes, marketNo }) {
  if (marketYes === null || marketNo === null) {
    return { marketUp: null, marketDown: null, edgeUp: null, edgeDown: null };
  }

  // Kalshi prices are already normalized (0-1), no need to sum
  const marketUp = marketYes;
  const marketDown = marketNo;

  const edgeUp = modelUp - marketUp;
  const edgeDown = modelDown - marketDown;

  return {
    marketUp: clamp(marketUp, 0, 1),
    marketDown: clamp(marketDown, 0, 1),
    edgeUp,
    edgeDown
  };
}

/**
 * Decide whether to enter a trade based on edge and timing
 * Adjusted for HOURLY markets (60 minutes) instead of 15 minutes
 *
 * Phases (scaled from 15m to 60m):
 * - EARLY: > 40 minutes remaining (2/3 of hour) - Lower thresholds
 * - MID: 20-40 minutes remaining (1/3 to 2/3) - Medium thresholds
 * - LATE: < 20 minutes remaining (< 1/3) - Higher thresholds (more certainty needed)
 */
export function decide({ remainingMinutes, edgeUp, edgeDown, modelUp = null, modelDown = null }) {
  // Adjust phases for hourly market (60 minutes total)
  const phase = remainingMinutes > 40 ? "EARLY" : remainingMinutes > 20 ? "MID" : "LATE";

  // Edge thresholds by phase
  // EARLY: More time to be right, lower threshold
  // MID: Moderate threshold
  // LATE: Less time, need higher confidence
  const threshold = phase === "EARLY" ? 0.05 : phase === "MID" ? 0.1 : 0.2;

  // Minimum model probability by phase
  const minProb = phase === "EARLY" ? 0.55 : phase === "MID" ? 0.6 : 0.65;

  if (edgeUp === null || edgeDown === null) {
    return { action: "NO_TRADE", side: null, phase, reason: "missing_market_data", edgeUp: null, edgeDown: null };
  }

  const bestSide = edgeUp > edgeDown ? "UP" : "DOWN";
  const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
  const bestModel = bestSide === "UP" ? modelUp : modelDown;

  // Check if edge meets threshold
  if (bestEdge < threshold) {
    return {
      action: "NO_TRADE",
      side: null,
      phase,
      reason: `edge_below_${threshold}`,
      edgeUp,
      edgeDown
    };
  }

  // Check if model probability meets minimum
  if (bestModel !== null && bestModel < minProb) {
    return {
      action: "NO_TRADE",
      side: null,
      phase,
      reason: `prob_below_${minProb}`,
      edgeUp,
      edgeDown
    };
  }

  // Classify strength of signal
  const strength = bestEdge >= 0.2 ? "STRONG" : bestEdge >= 0.1 ? "GOOD" : "OPTIONAL";

  return {
    action: "ENTER",
    side: bestSide,
    phase,
    strength,
    edge: bestEdge,
    edgeUp,
    edgeDown
  };
}
