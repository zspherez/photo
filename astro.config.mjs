import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import partytown from "@astrojs/partytown";

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
  ]
});