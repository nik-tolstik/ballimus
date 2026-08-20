import assert from "node:assert/strict";
import test from "node:test";

import {
  createRailwaySshArguments,
  evaluateCors,
  evaluateGitHubCi,
  evaluateMigrationStatus,
  evaluateRailwayServices,
  evaluateTelegramWebhookStatus,
  evaluateVercelStatus,
  parseJsonOutput,
  parsePublicProductionConfig,
} from "./verify-production.mjs";

const publicConfig = `
TELEGRAM_BOT_TOKEN=must-not-be-read
PRODUCTION_WEB_URL=https://ballimus.example.test
PRODUCTION_API_URL=https://api.ballimus.example.test
RAILWAY_PROJECT_ID=project_123
RAILWAY_ENVIRONMENT=production
RAILWAY_API_SERVICE=api
RAILWAY_JOBS_SERVICE=jobs
DATABASE_URL=postgresql://must-not-be-read
`;

test("reads only public production verifier configuration", () => {
  const config = parsePublicProductionConfig(publicConfig);

  assert.deepEqual(config, {
    webUrl: "https://ballimus.example.test",
    apiUrl: "https://api.ballimus.example.test",
    railwayProjectId: "project_123",
    railwayEnvironment: "production",
    railwayApiService: "api",
    railwayJobsService: "jobs",
  });
  assert.equal(JSON.stringify(config).includes("must-not-be-read"), false);
});

test("detects a GitHub CI run for another commit and a failed Vercel status", () => {
  assert.equal(evaluateGitHubCi([
    { workflowName: "CI", status: "completed", conclusion: "success", headSha: "old" },
  ], "current").ok, false);
  assert.equal(evaluateVercelStatus({
    statuses: [{ context: "Vercel", state: "failure" }],
  }).ok, false);
});

test("parses formatted JSON returned by Railway CLI", () => {
  assert.deepEqual(parseJsonOutput(JSON.stringify([
    { name: "api", status: "SUCCESS", stopped: false },
    { name: "jobs", status: "SUCCESS", stopped: true },
  ], null, 2), "Railway services"), [
    { name: "api", status: "SUCCESS", stopped: false },
    { name: "jobs", status: "SUCCESS", stopped: true },
  ]);
});

test("accepts healthy Railway, CORS, and migration checks", () => {
  assert.equal(evaluateGitHubCi([
    { workflowName: "CI", status: "completed", conclusion: "success", headSha: "current" },
  ], "current").ok, true);
  assert.equal(evaluateVercelStatus({
    statuses: [{ context: "Vercel", state: "success" }],
  }).ok, true);
  assert.equal(evaluateRailwayServices([
    { name: "api", status: "SUCCESS", stopped: false },
    { name: "jobs", status: "SUCCESS", stopped: true },
  ], "api", "jobs").ok, true);
  assert.equal(evaluateCors(new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "https://ballimus.example.test",
      "access-control-allow-methods": "GET,POST",
    },
  }), "https://ballimus.example.test").ok, true);
  assert.equal(evaluateMigrationStatus({
    migrationLedgerPresent: true,
    schemaPresent: true,
    appliedMigrationCount: 9,
  }, 9).ok, true);
});

test("rejects a wrong CORS origin and stale migration ledger", () => {
  assert.equal(evaluateRailwayServices([
    { name: "api", status: "FAILED", stopped: true },
    { name: "jobs", status: "SUCCESS", stopped: true },
  ], "api", "jobs").ok, false);
  assert.equal(evaluateCors(new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "https://other.example.test",
      "access-control-allow-methods": "GET",
    },
  }), "https://ballimus.example.test").ok, false);
  assert.equal(evaluateMigrationStatus({
    migrationLedgerPresent: true,
    schemaPresent: true,
    appliedMigrationCount: 8,
  }, 9).ok, false);
});

test("requires the production poll webhook to use the exact API URL", () => {
  const expected = "https://api.example.test/v1/telegram/webhook";
  assert.equal(evaluateTelegramWebhookStatus({ url: expected, pendingUpdateCount: 0 }, expected).ok, true);
  assert.equal(evaluateTelegramWebhookStatus({ url: "", pendingUpdateCount: 0 }, expected).ok, false);
  assert.equal(evaluateTelegramWebhookStatus({ url: "https://other.example.test/hook", pendingUpdateCount: 0 }, expected).ok, false);
  assert.equal(evaluateTelegramWebhookStatus({ url: expected, pendingUpdateCount: -1 }, expected).ok, false);
});

test("uses an explicit Railway SSH identity in CI", () => {
  const previousIdentity = process.env.RAILWAY_SSH_IDENTITY_FILE;
  process.env.RAILWAY_SSH_IDENTITY_FILE = "/tmp/railway-ci";
  try {
    assert.deepEqual(createRailwaySshArguments({
      railwayProjectId: "project",
      railwayEnvironment: "production",
      railwayApiService: "api",
    }, ["node", "status.js"]), [
      "exec", "railway", "ssh", "-p", "project", "-e", "production", "-s", "api",
      "-i", "/tmp/railway-ci", "--", "node", "status.js",
    ]);
  } finally {
    if (previousIdentity === undefined) delete process.env.RAILWAY_SSH_IDENTITY_FILE;
    else process.env.RAILWAY_SSH_IDENTITY_FILE = previousIdentity;
  }
});
