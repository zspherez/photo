import type { APIRoute } from "astro";
import { verifyAccess } from "../../lib/auth";
import {
  fetchPrintsViaD1,
  upsertPrint,
  type PrintInfo,
  type PrintSize,
} from "../../lib/prints";

// On-demand (SSR) route — runs on the Cloudflare deploy. On the static GitHub
// Pages mirror there is no worker, so this endpoint simply 404s there.
export const prerender = false;

const unavailable = () =>
  new Response(
    JSON.stringify({ error: "Dashboard API is only available on the canonical site." }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function getRuntime(locals: App.Locals) {
  return (locals as any)?.runtime?.env as CloudflareEnv | undefined;
}

export const GET: APIRoute = async ({ locals, request }) => {
  const env = getRuntime(locals);
  if (!env?.DB) return unavailable();

  const user = await verifyAccess(request, env as any);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const map = await fetchPrintsViaD1(env.DB);
  return json({ prints: map });
};

function sanitizeSizes(input: unknown): PrintSize[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const sizes = input
    .filter(
      (s) =>
        s &&
        typeof s.label === "string" &&
        typeof s.price === "string" &&
        s.label.trim() &&
        s.price.trim()
    )
    .map((s) => ({ label: String(s.label).trim(), price: String(s.price).trim() }));
  return sizes.length ? sizes : undefined;
}

export const PUT: APIRoute = async ({ locals, request }) => {
  const env = getRuntime(locals);
  if (!env?.DB) return unavailable();

  const user = await verifyAccess(request, env as any);
  if (!user) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const publicId = typeof body.public_id === "string" ? body.public_id.trim() : "";
  if (!publicId) return json({ error: "public_id is required" }, 400);

  const info: PrintInfo = {
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
    description:
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : undefined,
    price: typeof body.price === "string" && body.price.trim() ? body.price.trim() : undefined,
    sizes: sanitizeSizes(body.sizes),
    category:
      typeof body.category === "string" && body.category.trim() ? body.category.trim() : undefined,
  };

  try {
    await upsertPrint(env.DB, publicId, info);
  } catch (err) {
    return json({ error: `Save failed: ${(err as Error).message}` }, 500);
  }

  return json({ ok: true, public_id: publicId });
};
