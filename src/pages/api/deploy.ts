import type { APIRoute } from "astro";
import { verifyAccess } from "../../lib/auth";

export const prerender = false;

function getRuntime(locals: App.Locals) {
  return (locals as any)?.runtime?.env as CloudflareEnv | undefined;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const env = getRuntime(locals);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (!env) return json({ error: "Not available" }, 404);

  const user = await verifyAccess(request, env as any);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const hookUrl = env.CF_DEPLOY_HOOK_URL as string | undefined;
  if (!hookUrl) return json({ error: "CF_DEPLOY_HOOK_URL is not configured" }, 500);

  const res = await fetch(hookUrl, { method: "POST" });
  if (!res.ok) {
    return json({ error: `Deploy hook failed: ${res.status}` }, 500);
  }

  return json({ ok: true });
};
