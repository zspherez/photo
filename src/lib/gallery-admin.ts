import type { MediaAsset, MediaManifest } from "./media";

export const MANAGEABLE_GALLERIES = [
  "concerts",
  "music",
  "grads",
  "sports",
  "events",
  "bts",
  "lifestyle",
  "video",
  "system",
] as const;

export type ManageableGallery = (typeof MANAGEABLE_GALLERIES)[number];

export interface GalleryDraft {
  baseSha: string;
  manifest: MediaManifest;
  updatedAt: string;
}

const DRAFT_KEY = "admin/gallery-draft.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isManageableGallery(value: unknown): value is ManageableGallery {
  return (
    typeof value === "string" &&
    MANAGEABLE_GALLERIES.includes(value as ManageableGallery)
  );
}

export function parseMediaAsset(value: unknown): MediaAsset {
  if (!isRecord(value)) throw new Error("Invalid media asset");
  const publicId =
    typeof value.publicId === "string" ? value.publicId.trim() : "";
  const key = typeof value.key === "string" ? value.key.trim() : "";
  const width = Number(value.width);
  const height = Number(value.height);
  const aspectRatio = Number(value.aspectRatio);
  const type = value.type === "video" ? "video" : value.type === "image" ? "image" : null;
  if (
    !publicId ||
    !/^[A-Za-z0-9._-]{1,240}$/.test(publicId) ||
    !key ||
    key.includes("..") ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(aspectRatio) ||
    aspectRatio <= 0 ||
    !type
  ) {
    throw new Error("Invalid media asset");
  }
  const duration =
    value.duration === undefined ? undefined : Number(value.duration);
  if (
    duration !== undefined &&
    (!Number.isFinite(duration) || duration < 0)
  ) {
    throw new Error("Invalid media duration");
  }
  const posterKey =
    typeof value.posterKey === "string" && value.posterKey.trim()
      ? value.posterKey.trim()
      : undefined;
  if (posterKey?.includes("..")) throw new Error("Invalid poster key");
  return {
    publicId,
    key,
    width,
    height,
    aspectRatio,
    alt: typeof value.alt === "string" ? value.alt.slice(0, 500) : "",
    type,
    ...(duration !== undefined ? { duration } : {}),
    ...(posterKey ? { posterKey } : {}),
  };
}

function githubConfig(env: CloudflareEnv) {
  const repository = env.GALLERY_GITHUB_REPOSITORY || "zspherez/photo";
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Invalid GitHub repository");
  return {
    owner,
    repo,
    branch: env.GALLERY_GITHUB_BRANCH || "main",
    token: env.GALLERY_GITHUB_TOKEN,
  };
}

function githubHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rehders-photos-gallery-manager",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function sanitizeManifest(manifest: MediaManifest): MediaManifest {
  const sanitized = structuredClone(manifest);
  delete sanitized.folders.prints;
  return sanitized;
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(binary);
}

export async function readPublishedManifest(env: CloudflareEnv): Promise<{
  sha: string;
  manifest: MediaManifest;
}> {
  const config = githubConfig(env);
  const url = new URL(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/src/data/media-manifest.json`,
  );
  url.searchParams.set("ref", config.branch);
  const response = await fetch(url, {
    headers: githubHeaders(config.token),
  });
  if (!response.ok) {
    throw new Error(`GitHub manifest read failed (${response.status})`);
  }
  const result = (await response.json()) as {
    sha?: unknown;
    content?: unknown;
  };
  if (typeof result.sha !== "string" || typeof result.content !== "string") {
    throw new Error("GitHub manifest response is invalid");
  }
  const manifest = sanitizeManifest(
    JSON.parse(decodeBase64Utf8(result.content)) as MediaManifest,
  );
  return { sha: result.sha, manifest };
}

export async function readGalleryDraft(
  env: CloudflareEnv,
): Promise<GalleryDraft | null> {
  const object = await env.ORIGINALS.get(DRAFT_KEY);
  if (!object) return null;
  const draft = (await object.json()) as GalleryDraft;
  return {
    ...draft,
    manifest: sanitizeManifest(draft.manifest),
  };
}

export async function writeGalleryDraft(
  env: CloudflareEnv,
  draft: GalleryDraft,
): Promise<void> {
  await env.ORIGINALS.put(DRAFT_KEY, JSON.stringify(draft), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function ensureGalleryDraft(
  env: CloudflareEnv,
): Promise<GalleryDraft> {
  const existing = await readGalleryDraft(env);
  if (existing) return existing;
  const published = await readPublishedManifest(env);
  const draft = {
    baseSha: published.sha,
    manifest: published.manifest,
    updatedAt: new Date().toISOString(),
  };
  await writeGalleryDraft(env, draft);
  return draft;
}

export async function resetGalleryDraft(
  env: CloudflareEnv,
): Promise<GalleryDraft> {
  const published = await readPublishedManifest(env);
  const draft = {
    baseSha: published.sha,
    manifest: published.manifest,
    updatedAt: new Date().toISOString(),
  };
  await writeGalleryDraft(env, draft);
  return draft;
}

export async function publishGalleryDraft(
  env: CloudflareEnv,
  actor: string,
): Promise<{ commitSha: string }> {
  const config = githubConfig(env);
  if (!config.token) {
    throw new Error("GALLERY_GITHUB_TOKEN is not configured");
  }
  const draft = await readGalleryDraft(env);
  if (!draft) throw new Error("There are no staged gallery changes");
  const current = await readPublishedManifest(env);
  if (current.sha !== draft.baseSha) {
    throw new Error(
      "The repository manifest changed after this draft started. Reset the draft and reapply the changes.",
    );
  }
  const manifest = {
    ...sanitizeManifest(draft.manifest),
    generatedAt: new Date().toISOString(),
  };
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/src/data/media-manifest.json`,
    {
      method: "PUT",
      headers: {
        ...githubHeaders(config.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Publish gallery updates (${actor})`,
        content: encodeBase64Utf8(`${JSON.stringify(manifest, null, 2)}\n`),
        sha: current.sha,
        branch: config.branch,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub manifest publish failed (${response.status}): ${(
        await response.text()
      ).slice(0, 500)}`,
    );
  }
  const result = (await response.json()) as {
    commit?: { sha?: unknown };
  };
  const commitSha = result.commit?.sha;
  if (typeof commitSha !== "string") {
    throw new Error("GitHub publish response did not include a commit");
  }
  await env.ORIGINALS.delete(DRAFT_KEY);
  return { commitSha };
}

export function validateUploadKey(
  bucket: "originals" | "media",
  key: string,
): void {
  if (
    !key ||
    key.length > 600 ||
    key.includes("..") ||
    key.startsWith("/") ||
    key.endsWith("/")
  ) {
    throw new Error("Invalid upload key");
  }
  if (bucket === "originals") {
    if (
      !/^images\/(concerts|music|grads|sports|events|bts|lifestyle|system)\/[A-Za-z0-9._-]+$/.test(
        key,
      )
    ) {
      throw new Error("Invalid original key");
    }
    return;
  }
  const variant =
    /^variants\/(w-(192|320|480|640|960|1280|1600|1920)|fullscreen)\/images\/(concerts|music|grads|sports|events|bts|lifestyle|system)\/[A-Za-z0-9._-]+\.webp$/.test(
      key,
    );
  const video = /^videos\/[A-Za-z0-9._-]+\.mp4$/.test(key);
  const poster = /^posters\/[A-Za-z0-9._-]+\.webp$/.test(key);
  if (!variant && !video && !poster) {
    throw new Error("Invalid delivery key");
  }
}
