import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          OWNER_PASSWORD: "test-owner-password",
          COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef",
          CARD_IMAGES: "off",
        },
      },
    }),
  ],
  test: { include: ["worker-test/**/*.spec.mjs"] },
});
