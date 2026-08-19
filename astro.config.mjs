import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import partytown from "@astrojs/partytown";
import cloudflare from "@astrojs/cloudflare";

// One repo, two deploys:
//   • Cloudflare Pages (canonical) — runs the SSR dashboard + API (D1, Access).
//   • GitHub Pages (mirror) — static hosting; it serves the prerendered pages
//     and simply ignores the worker, so /admin and /api/* 404 there (intended).
//
// The Cloudflare adapter is always enabled so the few on-demand routes
// (`export const prerender = false`) build correctly. Every other page defaults
// to prerender=true and is emitted as static HTML for both hosts.
export default defineConfig({
  site: "https://rehde.rs",
  output: "static",
  adapter: cloudflare({
    // Expose Cloudflare R2 bindings from wrangler.toml to local development.
    platformProxy: { enabled: true },
    // Images are pre-generated and delivered directly from R2.
    imageService: "passthrough",
  }),
  integrations: [
    tailwind(),
    partytown({
      config: {
        debug: import.meta.env.DEV,
        forward: ["dataLayer.push", "gtag"],
      },
    }),
  ],
});
