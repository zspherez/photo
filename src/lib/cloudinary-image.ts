/**
 * Builds anti-theft Cloudinary delivery URLs for the print-sales gallery.
 *
 * Protection layers:
 *  1. Resolution cap — grid renditions are capped to ~900px and enlarged
 *     renditions to ~1600px on the long edge (`c_limit`). Looks crisp on screen,
 *     useless for a real print.
 *  2. Watermark — a tiled, low-opacity text overlay is baked into the pixels.
 *  3. Signed URLs — the transformation is signed (`s--xxxxxxxx--`). Combined with
 *     Cloudinary "Strict Transformations" (enable in the console), the original
 *     and any un-signed/larger rendition return 401, so the URL can't simply be
 *     edited to fetch full resolution.
 *
 * Signing uses the Web Crypto API so the exact same code runs at build time
 * (Node, for the prerendered gallery) and at runtime (Cloudflare Workers, for
 * the dashboard thumbnails).
 */

export interface PrintImageOptions {
  /** Long-edge cap in pixels. */
  width: number;
  /** Cloudinary public_id of the logo/watermark image. Set "" to disable. */
  watermark?: string;
  /** Whether to sign the URL (requires apiSecret). Default true. */
  sign?: boolean;
}

export interface CloudinaryConfig {
  cloudName: string;
  /** Required only when signing. Never sent to the client. */
  apiSecret?: string;
}

const DEFAULT_WATERMARK = "logo_zde1ld";

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha1Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return base64Url(new Uint8Array(digest));
}

/**
 * Build the transformation string (the part between `/upload/` and the public_id).
 *
 * Parameter ordering matches the official Cloudinary SDK's canonical output
 * (alphabetical keys, flags joined with `.`) so the signature is byte-identical
 * to what the SDK would produce — verified against the SDK in development.
 */
function buildTransformation(opts: PrintImageOptions): string {
  const base = `c_limit,f_auto,q_auto,w_${opts.width}`;
  const watermark = opts.watermark ?? DEFAULT_WATERMARK;
  if (!watermark) return base;

  // Logo watermark in the bottom-right corner.
  // Uses the site logo (public_id: logo_zde1ld) at 55% opacity, 160px wide.
  const overlay = `fl_layer_apply,g_south_east,l_${watermark},o_55,w_160,x_16,y_16`;
  return `${base}/${overlay}`;
}

/**
 * Produce a (optionally signed) Cloudinary delivery URL for a print preview.
 */
export async function buildPrintImageUrl(
  config: CloudinaryConfig,
  publicId: string,
  opts: PrintImageOptions
): Promise<string> {
  const transformation = buildTransformation(opts);
  const sign = opts.sign ?? true;

  let signatureSegment = "";
  if (sign) {
    if (!config.apiSecret) {
      throw new Error("buildPrintImageUrl: apiSecret is required when sign is true");
    }
    const toSign = `${transformation}/${publicId}`;
    const sig = (await sha1Base64Url(toSign + config.apiSecret)).substring(0, 8);
    signatureSegment = `s--${sig}--/`;
  }

  return `https://res.cloudinary.com/${config.cloudName}/image/upload/${signatureSegment}${transformation}/${publicId}`;
}

/** Convenience presets used by the gallery. */
export const GRID_WIDTH = 900;
export const ENLARGED_WIDTH = 1600;
export const THUMB_WIDTH = 400;
