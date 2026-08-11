import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentEnvironments, validateCloudflarePublicUrl } from "./dev-cloudflare.mjs";

test("validates a persistent Cloudflare HTTPS origin", () => {
  assert.equal(
    validateCloudflarePublicUrl("https://football-dev.example.com/"),
    "https://football-dev.example.com",
  );

  for (const value of [
    undefined,
    "",
    "http://football-dev.example.com",
    "https://user@example.com",
    "https://football-dev.example.com/path",
    "https://football-dev.example.com?debug=1",
  ]) {
    assert.throws(() => validateCloudflarePublicUrl(value));
  }
});

test("builds same-origin API and Vite environments for the public tunnel hostname", () => {
  const environments = createDevelopmentEnvironments(
    { DATABASE_URL: "postgresql://local.invalid/database", LOCAL_ONLY: "kept" },
    "https://football-dev.example.com",
  );

  assert.deepEqual(environments.api, {
    DATABASE_URL: "postgresql://local.invalid/database",
    LOCAL_ONLY: "kept",
    TELEGRAM_MINI_APP_URL: "https://football-dev.example.com",
    WEB_ORIGIN: "https://football-dev.example.com",
  });
  assert.deepEqual(environments.web, {
    DATABASE_URL: "postgresql://local.invalid/database",
    LOCAL_ONLY: "kept",
    VITE_API_BASE_URL: "https://football-dev.example.com",
    VITE_API_PROXY_TARGET: "http://127.0.0.1:6000",
    VITE_PUBLIC_HOST: "football-dev.example.com",
  });
});
