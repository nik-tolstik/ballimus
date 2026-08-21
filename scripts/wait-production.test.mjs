import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateGitHubCiForSha,
  evaluateRailwayForSha,
  evaluateVercelForSha,
  parseExpectedSha,
  waitForProduction,
} from "./wait-production.mjs";

const sha = "a".repeat(40);

test("requires a full production SHA", () => {
  assert.equal(parseExpectedSha(sha.toUpperCase()), sha);
  assert.throws(() => parseExpectedSha("abc"), /full Git commit SHA/);
});

test("waits for and rejects exact GitHub CI results", () => {
  assert.equal(evaluateGitHubCiForSha([], sha).state, "waiting");
  assert.equal(evaluateGitHubCiForSha([{ workflowName: "CI", headSha: sha, status: "in_progress" }], sha).state, "waiting");
  assert.equal(
    evaluateGitHubCiForSha([{ workflowName: "CI", headSha: sha, status: "completed", conclusion: "failure" }], sha).state,
    "failed",
  );
  assert.equal(
    evaluateGitHubCiForSha([{ workflowName: "CI", headSha: sha, status: "completed", conclusion: "success" }], sha).state,
    "ready",
  );
});

test("waits for Vercel and fails fast on a terminal result", () => {
  assert.equal(evaluateVercelForSha({ statuses: [] }).state, "waiting");
  assert.equal(evaluateVercelForSha({ statuses: [{ context: "Vercel", state: "pending" }] }).state, "waiting");
  assert.equal(evaluateVercelForSha({ statuses: [{ context: "Vercel", state: "failure" }] }).state, "failed");
  assert.equal(evaluateVercelForSha({ statuses: [{ context: "Vercel", state: "success" }] }).state, "ready");
});

test("accepts exact Railway success and skipped deployments", () => {
  assert.equal(evaluateRailwayForSha([], sha, "api").state, "waiting");
  assert.equal(evaluateRailwayForSha([{ status: "SUCCESS", meta: { commitHash: "b".repeat(40) } }], sha, "api").state, "waiting");
  assert.equal(evaluateRailwayForSha([{ status: "SUCCESS", meta: { commitHash: sha } }], sha, "api").state, "ready");
  assert.equal(evaluateRailwayForSha([{ status: "SKIPPED", meta: { commitHash: sha } }], sha, "api").state, "ready");
  assert.equal(evaluateRailwayForSha([{ status: "FAILED", meta: { commitHash: sha } }], sha, "api").state, "failed");
});

test("waits until every provider is ready", async () => {
  let attempts = 0;
  await waitForProduction({
    expectedSha: sha,
    timeoutMs: 100,
    intervalMs: 0,
    inspect: async () => {
      attempts += 1;
      const state = attempts === 1 ? "waiting" : "ready";
      return [{ name: "provider", state, summary: state }];
    },
    sleep: async () => {},
  });
  assert.equal(attempts, 2);
});
