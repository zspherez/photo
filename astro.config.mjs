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
    // Expose Cloudflare bindings (the D1 `DB` binding from wrangler.toml) to
    // `astro dev` so the dashboard works locally.
    platformProxy: { enabled: true },
    // All images go through Cloudinary's CDN — tell the adapter not to intercept
    // image URLs. Without this the adapter wraps CldImage URLs and breaks them.
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
