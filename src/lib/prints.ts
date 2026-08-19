/**
 * Print metadata access + resolution.
 *
 * Two read paths into the same Cloudflare D1 `prints` table:
 *   • `fetchPrintsViaRest()`  — build time (Node, prerendered gallery). Talks to
 *     D1's HTTPS REST API so even the GitHub Pages build (no binding) can read it.
 *   • `fetchPrintsViaD1(db)`  — runtime (Cloudflare Worker, dashboard + API) via
 *     the bound `DB` D1 database.
 *
 * `resolvePrint()` merges a DB row with manifest metadata and a
 * sensible default, so an image always renders something reasonable.
 */

export interface PrintSize {
  label: string;
  price: string;
}

export interface PrintInfo {
  title?: string;
  description?: string;
  /** Headline price, used when there are no per-size options. */
  price?: string;
  /** Optional size/price options. */
  sizes?: PrintSize[];
  /** Gallery filter category: "concert" | "knicks" | "landscape" */
  category?: string;
}

/** A row as stored in D1 (sizes is a JSON string there). */
export interface PrintRow {
  public_id: string;
  title: string | null;
  description: string | null;
  price: string | null;
  sizes: string | null;
  category: string | null;
  updated_at?: string;
}

export type PrintMap = Record<string, PrintInfo>;

import { calculatePrintSizes } from "./print-sizes";

/** Fallback description when nothing is set. */
export const defaultPrint: PrintInfo = {
  description: "Open-edition fine art print, signed on the reverse.",
};

function parseSizes(raw: string | null | undefined): PrintSize[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((s) => s && typeof s.label === "string" && typeof s.price === "string")
        .map((s) => ({ label: s.label, price: s.price }));
    }
  } catch {
    /* ignore malformed JSON */
  }
  return undefined;
}

export function rowToPrintInfo(row: PrintRow): PrintInfo {
  return {
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    price: row.price ?? undefined,
    sizes: parseSizes(row.sizes),
    category: row.category ?? undefined,
  };
}

/** Turn "prints/sunset-over-brooklyn" into "Sunset Over Brooklyn". */
export function humanizePublicId(publicId: string): string {
  const base = publicId.split("/").pop() ?? publicId;
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Merge DB row + manifest context + defaults into a guaranteed-complete object.
 * `widthPx` / `heightPx` — the photo's pixel dimensions; used to auto-calculate
 * available print sizes when none are explicitly set.
 * `globalDefaults` — the default pricing saved in the dashboard.
 */
export function resolvePrint(
  publicId: string,
  info?: PrintInfo,
  context?: Record<string, string> | undefined,
  widthPx?: number,
  heightPx?: number,
  globalDefaults?: PrintInfo,
): Required<Pick<PrintInfo, "title" | "description">> & PrintInfo {
  const title = info?.title || humanizePublicId(publicId);
  const description =
    info?.description || context?.caption || context?.alt || defaultPrint.description || "";
  const sizes = info?.sizes && info.sizes.length ? info.sizes : undefined;
  const price = info?.price || context?.price || undefined;

  const resolved: PrintInfo = { title, description };
  if (sizes) {
    // Explicit per-image override wins.
    resolved.sizes = sizes;
  } else if (price) {
    resolved.price = price;
  } else if (globalDefaults?.sizes?.length) {
    // Dashboard-managed defaults.
    resolved.sizes = globalDefaults.sizes;
  } else if (globalDefaults?.price) {
    resolved.price = globalDefaults.price;
  } else if (widthPx && heightPx) {
    // Auto-calculate from resolution as last resort.
    const calculated = calculatePrintSizes(widthPx, heightPx);
    if (calculated.length) resolved.sizes = calculated;
  }

  return resolved as Required<Pick<PrintInfo, "title" | "description">> & PrintInfo;
}

const SELECT_SQL =
  "SELECT public_id, title, description, price, sizes, category, updated_at FROM prints";

/**
 * Shared REST fetch of all rows (including the `DEFAULTS_KEY` row, unfiltered).
 * Requires env: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN.
 * Returns an empty array (and warns) if unconfigured, so builds never hard-fail.
 */
async function fetchRowsViaRest(
  env: Record<string, string | undefined>
): Promise<PrintRow[]> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  const databaseId = env.CF_D1_DATABASE_ID;
  const token = env.CF_D1_API_TOKEN;

  if (!accountId || !databaseId || !token) {
    console.warn(
      "[prints] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN not set — building gallery with no DB metadata."
    );
    return [];
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: SELECT_SQL }),
  });

  if (!res.ok) {
    console.warn(`[prints] D1 REST query failed (${res.status}); continuing without metadata.`);
    return [];
  }

  const json: any = await res.json();
  return json?.result?.[0]?.results ?? [];
}

/**
 * Build-time read via the Cloudflare D1 REST API.
 * Requires env: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN.
 * Returns an empty map (and warns) if unconfigured, so builds never hard-fail.
 */
export async function fetchPrintsViaRest(
  env: Record<string, string | undefined> = import.meta.env as any
): Promise<PrintMap> {
  const rows = await fetchRowsViaRest(env);
  return rowsToMap(rows);
}

/** Runtime read via the bound D1 database (Cloudflare Worker). */
export async function fetchPrintsViaD1(db: D1Database): Promise<PrintMap> {
  const { results } = await db.prepare(SELECT_SQL).all<PrintRow>();
  return rowsToMap(results ?? []);
}

function rowsToMap(rows: PrintRow[]): PrintMap {
  const map: PrintMap = {};
  for (const row of rows) {
    if (row.public_id !== DEFAULTS_KEY) map[row.public_id] = rowToPrintInfo(row);
  }
  return map;
}

/** Special public_id used to store the global default pricing. */
export const DEFAULTS_KEY = "__defaults__";

/**
 * Fetch the global default sizes/price from D1 (via binding, runtime).
 * Returns undefined if no defaults have been saved yet.
 */
export async function fetchDefaultsViaD1(db: D1Database): Promise<PrintInfo | undefined> {
  const row = await db
    .prepare("SELECT sizes, price FROM prints WHERE public_id = ?1")
    .bind(DEFAULTS_KEY)
    .first<{ sizes: string | null; price: string | null }>();
  if (!row) return undefined;
  return { sizes: parseSizes(row.sizes), price: row.price ?? undefined };
}

/**
 * Fetch the global default sizes/price via the D1 REST API (build time).
 * Returns undefined if unconfigured or no defaults saved.
 *
 * Reads from the unfiltered row list (not `fetchPrintsViaRest`'s map) since
 * that map deliberately excludes the `DEFAULTS_KEY` row.
 */
export async function fetchDefaultsViaRest(
  env: Record<string, string | undefined> = import.meta.env as any
): Promise<PrintInfo | undefined> {
  const rows = await fetchRowsViaRest(env);
  const row = rows.find((r) => r.public_id === DEFAULTS_KEY);
  if (!row) return undefined;
  return { sizes: parseSizes(row.sizes), price: row.price ?? undefined };
}

/** Upsert the global default pricing. */
export async function upsertDefaults(db: D1Database, info: PrintInfo): Promise<void> {
  return upsertPrint(db, DEFAULTS_KEY, info);
}


export async function upsertPrint(db: D1Database, publicId: string, info: PrintInfo): Promise<void> {
  const sizesJson =
    info.sizes && info.sizes.length ? JSON.stringify(info.sizes) : null;
  await db
    .prepare(
      `INSERT INTO prints (public_id, title, description, price, sizes, category, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
       ON CONFLICT(public_id) DO UPDATE SET
         title = ?2, description = ?3, price = ?4, sizes = ?5, category = ?6, updated_at = datetime('now')`
    )
    .bind(
      publicId,
      info.title ?? null,
      info.description ?? null,
      info.price ?? null,
      sizesJson,
      info.category ?? null,
    )
    .run();
}
