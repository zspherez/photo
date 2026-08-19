import type { APIRoute } from "astro";
import { verifyAccess } from "../../../lib/auth";
import { validateUploadKey } from "../../../lib/gallery-admin";

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const PUT: APIRoute = async ({ locals, request }) => {
  const env = (locals as any)?.runtime?.env as CloudflareEnv | undefined;
  if (!env?.ORIGINALS || !env.MEDIA) {
    return json({ error: "Gallery storage is not configured" }, 503);
  }
  const user = await verifyAccess(request, env as any);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const bucketName = request.headers.get("X-Media-Bucket");
  const key = request.headers.get("X-Media-Key") || "";
  if (bucketName !== "originals" && bucketName !== "media") {
    return json({ error: "Invalid media bucket" }, 400);
  }
  try {
    validateUploadKey(bucketName, key);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
  if (!request.body) return json({ error: "Missing upload body" }, 400);
  const contentLengthHeader = request.headers.get("Content-Length");
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : Number.NaN;
  if (
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > 95 * 1024 * 1024
  ) {
    return json({ error: "Upload must be between 1 byte and 95 MB" }, 413);
  }
  const contentType =
    request.headers.get("Content-Type") || "application/octet-stream";
  const validContent =
    bucketName === "originals"
      ? contentType.startsWith("image/")
      : key.startsWith("videos/")
        ? contentType === "video/mp4"
        : contentType === "image/webp";
  if (!validContent) {
    return json({ error: "Upload content type does not match its key" }, 400);
  }

  const bucket = bucketName === "originals" ? env.ORIGINALS : env.MEDIA;
  type FixedLengthStreamConstructor = new (length: number) => {
    readable: ReadableStream;
    writable: WritableStream;
  };
  const FixedLengthStreamConstructor = (
    globalThis as unknown as {
      FixedLengthStream?: FixedLengthStreamConstructor;
    }
  ).FixedLengthStream;
  let body: ReadableStream | ArrayBuffer;
  let streaming: Promise<void> | null = null;
  if (typeof FixedLengthStreamConstructor === "function") {
    const fixed = new FixedLengthStreamConstructor(contentLength);
    streaming = request.body.pipeTo(fixed.writable);
    body = fixed.readable;
  } else {
    body = await request.arrayBuffer();
  }
  const uploaded = await bucket.put(key, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType,
      cacheControl:
        bucketName === "media"
          ? "public, max-age=31536000, immutable"
          : undefined,
    },
  });
  if (streaming) await streaming;
  if (!uploaded) {
    return json({ error: "Upload key already exists; retry the upload" }, 409);
  }
  if (uploaded.size > 95 * 1024 * 1024) {
    await bucket.delete(key);
    return json({ error: "Upload exceeds the 95 MB limit" }, 413);
  }
  return json({ ok: true, key });
};
