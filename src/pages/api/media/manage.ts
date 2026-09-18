import type { APIRoute } from "astro";
import { verifyAccess } from "../../../lib/auth";
import {
  ensureGalleryDraft,
  isManageableGallery,
  parseMediaAsset,
  publishGalleryDraft,
  resetGalleryDraft,
  writeGalleryDraft,
} from "../../../lib/gallery-admin";

export const prerender = false;

function runtime(locals: App.Locals): CloudflareEnv | undefined {
  return (locals as any)?.runtime?.env as CloudflareEnv | undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function authorized(
  locals: App.Locals,
  request: Request,
): Promise<{ env: CloudflareEnv; actor: string } | Response> {
  const env = runtime(locals);
  if (!env?.ORIGINALS || !env.MEDIA) {
    return json({ error: "Gallery storage is not configured" }, 503);
  }
  const user = await verifyAccess(request, env as any);
  if (!user) return json({ error: "Unauthorized" }, 401);
  return { env, actor: user.email || user.sub || "gallery-admin" };
}

export const GET: APIRoute = async ({ locals, request }) => {
  const access = await authorized(locals, request);
  if (access instanceof Response) return access;
  try {
    return json({
      draft: await ensureGalleryDraft(access.env),
      publishConfigured: Boolean(access.env.GALLERY_GITHUB_TOKEN),
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const access = await authorized(locals, request);
  if (access instanceof Response) return access;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = body.action;
  try {
    if (action === "reset") {
      return json({ draft: await resetGalleryDraft(access.env) });
    }
    if (action === "publish") {
      return json(await publishGalleryDraft(access.env, access.actor));
    }

    const draft = await ensureGalleryDraft(access.env);
    if (!isManageableGallery(body.folder)) {
      return json({ error: "Invalid gallery" }, 400);
    }
    const folder = body.folder;
    const current = [...(draft.manifest.folders[folder] ?? [])];

    if (action === "upsert") {
      const asset = parseMediaAsset(body.asset);
      if (
        (folder === "video" && asset.type !== "video") ||
        (folder !== "video" && asset.type !== "image")
      ) {
        return json({ error: "Asset type does not match gallery" }, 400);
      }
      const replacePublicId =
        typeof body.replacePublicId === "string"
          ? body.replacePublicId.trim()
          : "";
      const next = replacePublicId
        ? current.filter((item) => item.publicId !== replacePublicId)
        : current.filter((item) => item.publicId !== asset.publicId);
      const insertionIndex = replacePublicId
        ? Math.max(
            0,
            current.findIndex((item) => item.publicId === replacePublicId),
          )
        : next.length;
      next.splice(Math.min(insertionIndex, next.length), 0, asset);
      draft.manifest.folders[folder] = next;
    } else if (action === "upsert-many") {
      if (folder === "video" || folder === "system") {
        return json(
          { error: "Bulk image uploads are not supported for this gallery" },
          400,
        );
      }
      if (
        !Array.isArray(body.assets) ||
        body.assets.length === 0 ||
        body.assets.length > 500
      ) {
        return json(
          { error: "Bulk uploads must contain between 1 and 500 images" },
          400,
        );
      }
      const assets = body.assets.map(parseMediaAsset);
      if (assets.some((asset) => asset.type !== "image")) {
        return json({ error: "Bulk uploads must contain only images" }, 400);
      }
      const next = [...current];
      for (const asset of assets) {
        const existingIndex = next.findIndex(
          (item) => item.publicId === asset.publicId,
        );
        if (existingIndex === -1) next.push(asset);
        else next[existingIndex] = asset;
      }
      draft.manifest.folders[folder] = next;
    } else if (action === "delete") {
      const publicId =
        typeof body.publicId === "string" ? body.publicId.trim() : "";
      if (!publicId) return json({ error: "Missing asset identity" }, 400);
      draft.manifest.folders[folder] = current.filter(
        (asset) => asset.publicId !== publicId,
      );
    } else if (action === "delete-all") {
      if (folder === "system") {
        return json({ error: "Site images cannot be cleared" }, 400);
      }
      draft.manifest.folders[folder] = [];
    } else if (action === "reorder") {
      const order = Array.isArray(body.order)
        ? body.order.filter((item): item is string => typeof item === "string")
        : [];
      if (
        order.length !== current.length ||
        new Set(order).size !== current.length
      ) {
        return json({ error: "Invalid gallery order" }, 400);
      }
      const byId = new Map(current.map((asset) => [asset.publicId, asset]));
      const reordered = order.map((publicId) => byId.get(publicId));
      if (reordered.some((asset) => !asset)) {
        return json({ error: "Gallery order contains an unknown asset" }, 400);
      }
      draft.manifest.folders[folder] =
        reordered as typeof current;
    } else {
      return json({ error: "Unsupported gallery action" }, 400);
    }

    draft.updatedAt = new Date().toISOString();
    await writeGalleryDraft(access.env, draft);
    return json({ draft });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      409,
    );
  }
};
