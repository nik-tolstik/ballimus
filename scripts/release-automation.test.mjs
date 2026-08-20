import assert from "node:assert/strict";
import test from "node:test";

import {
  RAILWAY_REGION_ALIASES,
  parseProductionCutoverConfig,
} from "./production-release-config.mjs";
import { createCutoverPlan, cutoverIsConfirmed } from "./release-cutover.mjs";
import { evaluateRailwayCliVersion, evaluateReleaseCheckout } from "./release-preflight.mjs";

const publicConfig = `
PRODUCTION_WEB_URL=https://ballimus.example.test
PRODUCTION_API_URL=https://api.ballimus.example.test
RAILWAY_PROJECT_ID=project_123
RAILWAY_ENVIRONMENT=production
RAILWAY_API_SERVICE=api
RAILWAY_JOBS_SERVICE=jobs
RAILWAY_PRODUCTION_REGION_ALIAS=eu-west
`;

test("accepts only Railway's documented scale aliases", () => {
  assert.deepEqual(RAILWAY_REGION_ALIASES, ["us-west", "us-east", "eu-west", "southeast-asia"]);
  assert.equal(parseProductionCutoverConfig(publicConfig).railwayRegionAlias, "eu-west");
  assert.throws(
    () => parseProductionCutoverConfig(publicConfig.replace("eu-west", "europe-west4-drams3a")),
    /RAILWAY_PRODUCTION_REGION_ALIAS/,
  );
});

test("builds a cutover plan that never scales by Railway's internal region ID", () => {
  const plan = createCutoverPlan(parseProductionCutoverConfig(publicConfig));
  assert.equal(plan.length, 4);
  assert.ok(plan[0]?.argumentsToRun.includes("eu-west=0"));
  assert.equal(plan.some((step) => step.argumentsToRun.some((argument) => argument.includes("europe-west4"))), false);
});

test("uses Railway's Windows-safe short service selectors", () => {
  const plan = createCutoverPlan(parseProductionCutoverConfig(publicConfig));
  for (const step of plan) {
    assert.ok(step.argumentsToRun.includes("-p"));
    assert.ok(step.argumentsToRun.includes("-e"));
    assert.ok(step.argumentsToRun.includes("-s"));
    assert.equal(step.argumentsToRun.includes("--project"), false);
    assert.equal(step.argumentsToRun.includes("--environment"), false);
    assert.equal(step.argumentsToRun.includes("--service"), false);
  }
});

test("requires an explicit production confirmation", () => {
  assert.equal(cutoverIsConfirmed([]), false);
  assert.equal(cutoverIsConfirmed(["--confirm-production-cutover"]), true);
});

test("rejects Railway CLI v4 and a stale release checkout", () => {
  assert.equal(evaluateRailwayCliVersion("4.36.1").ok, false);
  assert.equal(evaluateRailwayCliVersion("5.35.0").ok, true);
  assert.equal(evaluateReleaseCheckout("main", "", "same", "same").ok, true);
  assert.equal(evaluateReleaseCheckout("feature", "", "same", "same").ok, false);
  assert.equal(evaluateReleaseCheckout("main", "M scripts/release.mjs", "same", "same").ok, false);
  assert.equal(evaluateReleaseCheckout("main", "", "head", "origin").ok, false);
});
