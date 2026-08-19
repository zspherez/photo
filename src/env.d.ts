/// <reference path="../.astro/types.d.ts" />
/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare bindings + variables available at runtime via
 * `Astro.locals.runtime.env` on the Cloudflare deploy.
 */
interface CloudflareEnv {
  ORIGINALS: R2Bucket;
  MEDIA: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  GALLERY_GITHUB_TOKEN?: string;
  GALLERY_GITHUB_REPOSITORY?: string;
  GALLERY_GITHUB_BRANCH?: string;
  DASHBOARD_DEV_BYPASS?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: CloudflareEnv;
    };
  }
}
