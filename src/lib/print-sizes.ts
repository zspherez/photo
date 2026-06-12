/**
 * Resolution-based print size calculator.
 *
 * Determines which standard print sizes are achievable at acceptable quality
 * for a given photo resolution, using industry-standard DPI thresholds:
 *
 *   • Small prints (≤11×14"):  200 DPI minimum  — gallery/fine-art quality
 *   • Medium prints (≤16×24"): 150 DPI minimum  — standard professional quality
 *   • Large format (≤24×36"):  100 DPI minimum  — large-format / viewing distance
 *
 * The logic fits the photo into the print (letterbox — no cropping), so the DPI
 * check uses the photo's constraining dimension vs. the print's constraining side.
 */

import type { PrintSize } from "./prints";

interface PrintSpec {
  /** Short-edge inches */
  short: number;
  /** Long-edge inches */
  long: number;
  label: string;
  /** Default price for this size */
  price: string;
  /** Minimum DPI threshold for this size */
  minDpi: number;
}

const STANDARD_SIZES: PrintSpec[] = [
  { short: 4,  long: 5,  label: '4×5"',   price: "$25",  minDpi: 200 },
  { short: 4,  long: 6,  label: '4×6"',   price: "$30",  minDpi: 200 },
  { short: 5,  long: 7,  label: '5×7"',   price: "$35",  minDpi: 200 },
  { short: 8,  long: 10, label: '8×10"',  price: "$50",  minDpi: 200 },
  { short: 8,  long: 12, label: '8×12"',  price: "$60",  minDpi: 200 },
  { short: 11, long: 14, label: '11×14"', price: "$85",  minDpi: 200 },
  { short: 12, long: 18, label: '12×18"', price: "$110", minDpi: 150 },
  { short: 16, long: 20, label: '16×20"', price: "$150", minDpi: 150 },
  { short: 16, long: 24, label: '16×24"', price: "$175", minDpi: 150 },
  { short: 20, long: 24, label: '20×24"', price: "$200", minDpi: 100 },
  { short: 20, long: 30, label: '20×30"', price: "$250", minDpi: 100 },
  { short: 24, long: 36, label: '24×36"', price: "$350", minDpi: 100 },
];

/**
 * Returns which standard print sizes are achievable at acceptable quality
 * for a photo of the given pixel dimensions.
 *
 * The photo is fitted (letterboxed) into the print — no cropping assumed —
 * so DPI is calculated against the photo's constraining (short) edge.
 */
export function calculatePrintSizes(widthPx: number, heightPx: number): PrintSize[] {
  const shortPx = Math.min(widthPx, heightPx);
  const longPx  = Math.max(widthPx, heightPx);

  return STANDARD_SIZES.filter((spec) => {
    // Fit-to-print: scale so the long edge fills the print's long side,
    // then check what DPI the short edge achieves.
    const scale = longPx / spec.long;
    const effectiveDpi = shortPx / (spec.short * (longPx / (scale * spec.long)));
    // Simplified: effectiveDpi = shortPx / spec.short when aspect ratios match.
    // When they differ, the photo is letterboxed so the short edge is the limit.
    const dpi = shortPx / spec.short;
    return dpi >= spec.minDpi;
  }).map((spec) => ({ label: spec.label, price: spec.price }));
}

/**
 * Human-readable summary of the largest printable size, e.g. "Up to 24×36"".
 */
export function maxPrintSizeLabel(widthPx: number, heightPx: number): string | null {
  const sizes = calculatePrintSizes(widthPx, heightPx);
  return sizes.length ? sizes[sizes.length - 1].label : null;
}
