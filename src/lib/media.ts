import manifestData from "../data/media-manifest.json";

export interface MediaAsset {
  publicId: string;
  key: string;
  width: number;
  height: number;
  aspectRatio: number;
  alt: string;
  type: "image" | "video";
  duration?: number;
  posterKey?: string;
}

export interface MediaManifest {
  version: number;
  generatedAt: string;
  folders: Record<string, MediaAsset[]>;
}

const manifest = manifestData as MediaManifest;

export function getMediaManifest(): MediaManifest {
  return structuredClone(manifest);
}

export const MEDIA_BASE_URL =
  import.meta.env.PUBLIC_MEDIA_BASE_URL || "https://media.rehders.photos";

export function getMediaFolder(folder: string): MediaAsset[] {
  return manifest.folders[folder] ?? [];
}

export function encodeMediaKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function buildMediaUrl(key: string): string {
  return `${MEDIA_BASE_URL}/${encodeMediaKey(key)}`;
}

export function buildImageUrl(key: string, preset: string): string {
  const variantKey = key.replace(/\.[^./]+$/, ".webp");
  return buildMediaUrl(`variants/${preset}/${variantKey}`);
}
