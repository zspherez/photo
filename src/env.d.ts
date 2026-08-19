/// <reference path="../.astro/types.d.ts" />
/// <reference types="@cloudflare/workers-types" />

type D1Database = import("@cloudflare/workers-types").D1Database;

/**
 * Cloudflare bindings + variables available at runtime via
 * `Astro.locals.runtime.env` on the Cloudflare deploy.
 */
interface CloudflareEnv {
  DB: D1Database;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_DEPLOY_HOOK_URL?: string;
  DASHBOARD_DEV_BYPASS?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: CloudflareEnv;
    };
  }
}
