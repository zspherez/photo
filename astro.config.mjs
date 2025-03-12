import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import partytown from "@astrojs/partytown";
import cloudflare from '@astrojs/cloudflare';


// https://astro.build/config
export default defineConfig({
  site: "https://rehde.rs",
  integrations: [tailwind(),
    partytown({
    config: {
      debug: true,
      forward: ['dataLayer.push', 'gtag']
    }
  })]
});