/**
 * Print metadata access + resolution.
 *
 * Two read paths into the same Cloudflare D1 `prints` table:
 *   • `fetchPrintsViaRest()`  — build time (Node, prerendered gallery). Talks to
 *     D1's HTTPS REST API so even the GitHub Pages build (no binding) can read it.
 *   • `fetchPrintsViaD1(db)`  — runtime (Cloudflare Worker, dashboard + API) via
 *     the bound `DB` D1 database.
 *
 * `resolvePrint()` merges a DB row with Cloudinary contextual metadata and a
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
}

/** A row as stored in D1 (sizes is a JSON string there). */
export interface PrintRow {
  public_id: string;
  title: string | null;
  description: string | null;
  price: string | null;
  sizes: string | null;
  updated_at?: string;
}

export type PrintMap = Record<string, PrintInfo>;

/** Shown when an image has no DB row and no Cloudinary context. */
export const defaultPrint: PrintInfo = {
  description: "Open-edition fine art print, signed on the reverse.",
  sizes: [
    { label: '8×10"', price: "$45" },
    { label: '16×24"', price: "$120" },
    { label: '24×36"', price: "$240" },
  ],
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
 * Merge DB row + Cloudinary context + defaults into a guaranteed-complete object.
 * `context` is Cloudinary's contextual metadata (e.g. `{ caption, alt, price }`).
 */
export function resolvePrint(
  publicId: string,
  info?: PrintInfo,
  context?: Record<string, string> | undefined
): Required<Pick<PrintInfo, "title" | "description">> & PrintInfo {
  const title = info?.title || humanizePublicId(publicId);
  const description =
    info?.description || context?.caption || context?.alt || defaultPrint.description || "";
  const sizes = info?.sizes && info.sizes.length ? info.sizes : undefined;
  const price = info?.price || context?.price || undefined;

  // If neither explicit sizes nor a price exist, fall back to the default sizes.
  const resolved: PrintInfo = { title, description };
  if (sizes) resolved.sizes = sizes;
  else if (price) resolved.price = price;
  else resolved.sizes = defaultPrint.sizes;

  return resolved as Required<Pick<PrintInfo, "title" | "description">> & PrintInfo;
}

const SELECT_SQL =
  "SELECT public_id, title, description, price, sizes, updated_at FROM prints";

/**
 * Build-time read via the Cloudflare D1 REST API.
 * Requires env: CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN.
 * Returns an empty map (and warns) if unconfigured, so builds never hard-fail.
 */
export async function fetchPrintsViaRest(
  env: Record<string, string | undefined> = import.meta.env as any
): Promise<PrintMap> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID;
  const databaseId = env.CF_D1_DATABASE_ID;
  const token = env.CF_D1_API_TOKEN;

  if (!accountId || !databaseId || !token) {
    console.warn(
      "[prints] CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_D1_API_TOKEN not set — building gallery with no DB metadata."
    );
    return {};
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
    return {};
  }

  const json: any = await res.json();
  const rows: PrintRow[] = json?.result?.[0]?.results ?? [];
  return rowsToMap(rows);
}

/** Runtime read via the bound D1 database (Cloudflare Worker). */
export async function fetchPrintsViaD1(db: D1Database): Promise<PrintMap> {
  const { results } = await db.prepare(SELECT_SQL).all<PrintRow>();
  return rowsToMap(results ?? []);
}

function rowsToMap(rows: PrintRow[]): PrintMap {
  const map: PrintMap = {};
  for (const row of rows) map[row.public_id] = rowToPrintInfo(row);
  return map;
}

/** Upsert a single print's metadata (runtime, D1 binding). */
export async function upsertPrint(db: D1Database, publicId: string, info: PrintInfo): Promise<void> {
  const sizesJson =
    info.sizes && info.sizes.length ? JSON.stringify(info.sizes) : null;
  await db
    .prepare(
      `INSERT INTO prints (public_id, title, description, price, sizes, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(public_id) DO UPDATE SET
         title = ?2, description = ?3, price = ?4, sizes = ?5, updated_at = datetime('now')`
    )
    .bind(
      publicId,
      info.title ?? null,
      info.description ?? null,
      info.price ?? null,
      sizesJson
    )
    .run();
}
