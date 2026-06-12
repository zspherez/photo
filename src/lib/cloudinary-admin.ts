/**
 * Minimal Cloudinary Admin API client using `fetch` + Basic auth, so it runs on
 * Cloudflare Workers (the dashboard is SSR). Avoids the Node-only Cloudinary SDK
 * at runtime.
 */

export interface AdminResource {
  public_id: string;
  width: number;
  height: number;
  context?: { custom?: Record<string, string> };
}

export interface CloudinaryAdminConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Search a folder for images, newest display-name order, including context. */
export async function searchFolder(
  config: CloudinaryAdminConfig,
  folder: string,
  maxResults = 500
): Promise<AdminResource[]> {
  const url = `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/search`;
  const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expression: `folder:${folder} AND resource_type:image`,
      with_field: ["context"],
      sort_by: [{ display_name: "asc" }],
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    throw new Error(`Cloudinary admin search failed: ${res.status} ${await res.text()}`);
  }
  const json: any = await res.json();
  return (json.resources ?? []) as AdminResource[];
}
