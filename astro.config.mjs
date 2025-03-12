import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import partytown from "@astrojs/partytown";
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: "https://rehde.rs",
  integrations: [
    tailwind(), 
    // Remove the image integration or keep it only for local images
    mdx(), 
    partytown({
      config: {
        debug: true,
        forward: ['dataLayer.push', 'gtag']
      }
    })
  ],
  output: "server",
  adapter: cloudflare(),
  server: {
    headers: {
      // 👇 `credentialless` is the trick to get both WebContainers & CORS images to both load
      // See: https://developer.chrome.com/blog/coep-credentialless-origin-trial/#credentialless-to-the-rescue
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});