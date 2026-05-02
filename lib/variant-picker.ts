import type { Rule, DmButton } from "@/types/db";

export type PickedVariant = {
  message: string;
  buttons: DmButton[] | null;
  variant_index: number | null; // null = no variant system, used base message
};

/**
 * Picks a variant to send for a rule.
 *
 * Order of precedence:
 * 1. If rule.variants is non-empty → use epsilon-greedy (Thompson-ish simple)
 *    - 80% of time, pick variant with highest conversion rate (so far)
 *    - 20% of time, explore other variants (uniformly)
 *    - Until each variant has >= 20 hits, round-robin uniformly (exploration phase)
 * 2. Else → return base message + base buttons, variant_index = null.
 */
export function pickVariant(rule: Rule): PickedVariant {
  const variants = rule.variants;
  if (!variants || variants.length === 0) {
    return {
      message: rule.dm_message,
      buttons: rule.dm_buttons ?? null,
      variant_index: null,
    };
  }

  const hits = rule.variant_hits ?? [];
  const convs = rule.variant_conversions ?? [];

  const totalHits = hits.reduce((a, b) => a + (b ?? 0), 0);
  const minHitsPerVariant = 20;
  const explorationComplete = hits.every(
    (h) => (h ?? 0) >= minHitsPerVariant
  );

  let chosenIdx = 0;

  if (!explorationComplete) {
    // Round-robin: pick least-served variant (smaller hit count wins)
    chosenIdx = hits.indexOf(
      Math.min(...hits.concat(new Array(variants.length - hits.length).fill(0)))
    );
    if (chosenIdx < 0) chosenIdx = totalHits % variants.length;
  } else {
    // Epsilon-greedy: 20% explore, 80% exploit best conversion rate
    if (Math.random() < 0.2) {
      chosenIdx = Math.floor(Math.random() * variants.length);
    } else {
      let bestRate = -1;
      let bestIdx = 0;
      for (let i = 0; i < variants.length; i++) {
        const rate = (hits[i] ?? 0) > 0 ? (convs[i] ?? 0) / (hits[i] ?? 1) : 0;
        if (rate > bestRate) {
          bestRate = rate;
          bestIdx = i;
        }
      }
      chosenIdx = bestIdx;
    }
  }

  const v = variants[chosenIdx];
  return {
    message: v.message || rule.dm_message,
    buttons: v.buttons ?? rule.dm_buttons ?? null,
    variant_index: chosenIdx,
  };
}

/**
 * Computes stats for a rule's variants (for dashboard display).
 */
export function variantStats(rule: Rule): Array<{
  index: number;
  message_preview: string;
  hits: number;
  conversions: number;
  rate: number;
  is_leader: boolean;
}> | null {
  const variants = rule.variants;
  if (!variants || variants.length === 0) return null;
  const hits = rule.variant_hits ?? [];
  const convs = rule.variant_conversions ?? [];

  const rates = variants.map((_, i) => {
    const h = hits[i] ?? 0;
    const c = convs[i] ?? 0;
    return h > 0 ? c / h : 0;
  });
  const maxRate = Math.max(...rates);

  return variants.map((v, i) => ({
    index: i,
    message_preview: (v.message || "").slice(0, 80),
    hits: hits[i] ?? 0,
    conversions: convs[i] ?? 0,
    rate: rates[i],
    is_leader: rates[i] === maxRate && maxRate > 0,
  }));
}
