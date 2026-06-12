/**
 * Resolution- and aspect-ratio-based print size calculator.
 *
 * `calculateSizesMatchingAspectRatio` returns only the standard sizes that:
 *   1. The photo has enough resolution to print at acceptable DPI, AND
 *   2. Share (approximately) the same aspect ratio as the photo.
 *
 * A fixed "Other sizes/ratios available" entry is always appended in the
 * gallery so buyers know they can ask for crops or uncommon formats.
 *
 * DPI thresholds (industry standard):
 *   • Small prints  ≤11×14": 200 DPI minimum
 *   • Medium prints ≤16×24": 150 DPI minimum
 *   • Large format  ≤24×36": 100 DPI minimum
 *
 * Aspect-ratio tolerance: ±12 % of the photo's long:short ratio.
 */

import type { PrintSize } from "./prints";

export interface PrintSpec {
  short: number;
  long: number;
  label: string;
  /** Default price shown when no override is set. */
  defaultPrice: string;
  minDpi: number;
}

export const STANDARD_SIZES: PrintSpec[] = [
  { short: 4,  long: 5,  label: '4×5"',   defaultPrice: "$25",  minDpi: 200 },
  { short: 4,  long: 6,  label: '4×6"',   defaultPrice: "$30",  minDpi: 200 },
  { short: 5,  long: 7,  label: '5×7"',   defaultPrice: "$35",  minDpi: 200 },
  { short: 8,  long: 10, label: '8×10"',  defaultPrice: "$50",  minDpi: 200 },
  { short: 8,  long: 12, label: '8×12"',  defaultPrice: "$60",  minDpi: 200 },
  { short: 11, long: 14, label: '11×14"', defaultPrice: "$85",  minDpi: 200 },
  { short: 12, long: 18, label: '12×18"', defaultPrice: "$110", minDpi: 150 },
  { short: 16, long: 20, label: '16×20"', defaultPrice: "$150", minDpi: 150 },
  { short: 16, long: 24, label: '16×24"', defaultPrice: "$175", minDpi: 150 },
  { short: 20, long: 24, label: '20×24"', defaultPrice: "$200", minDpi: 100 },
  { short: 20, long: 30, label: '20×30"', defaultPrice: "$250", minDpi: 100 },
  { short: 24, long: 36, label: '24×36"', defaultPrice: "$350", minDpi: 100 },
];

/** Appended after the matching sizes in the gallery. */
export const OTHER_SIZES_ENTRY: PrintSize = {
  label: "Other sizes/ratios",
  price: "Varies",
};

/**
 * Returns standard sizes that match the photo's aspect ratio (±12%) AND
 * meet the minimum DPI threshold at that size.
 */
export function calculateSizesMatchingAspectRatio(
  widthPx: number,
  heightPx: number,
  tolerance = 0.12,
): PrintSpec[] {
  if (!widthPx || !heightPx) return [];
  const shortPx   = Math.min(widthPx, heightPx);
  const longPx    = Math.max(widthPx, heightPx);
  const photoRatio = longPx / shortPx;

  return STANDARD_SIZES.filter((spec) => {
    const dpi       = shortPx / spec.short;
    if (dpi < spec.minDpi) return false;
    const sizeRatio = spec.long / spec.short;
    return Math.abs(sizeRatio - photoRatio) / photoRatio <= tolerance;
  });
}

/** All resolution-valid sizes regardless of aspect ratio. */
export function calculatePrintSizes(widthPx: number, heightPx: number): PrintSize[] {
  if (!widthPx || !heightPx) return [];
  const shortPx = Math.min(widthPx, heightPx);
  return STANDARD_SIZES
    .filter((spec) => shortPx / spec.short >= spec.minDpi)
    .map((spec) => ({ label: spec.label, price: spec.defaultPrice }));
}

/** Label of the largest printable size, e.g. `24×36"`. */
export function maxPrintSizeLabel(widthPx: number, heightPx: number): string | null {
  const sizes = calculatePrintSizes(widthPx, heightPx);
  return sizes.length ? sizes[sizes.length - 1].label : null;
}
