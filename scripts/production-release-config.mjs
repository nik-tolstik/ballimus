import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const publicProductionConfigNames = [
  "PRODUCTION_WEB_URL",
  "PRODUCTION_API_URL",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_API_SERVICE",
  "RAILWAY_JOBS_SERVICE",
];

export const RAILWAY_REGION_ALIASES = ["us-west", "us-east", "eu-west", "southeast-asia"];

function stringValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readDotenvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.at(-1) === quote) return trimmed.slice(1, -1);
  return trimmed;
}

function dotenvValues(source, names) {
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (match === null) continue;
    const [, name, rawValue] = match;
    if (name !== undefined && rawValue !== undefined && names.includes(name)) {
      values[name] = readDotenvValue(rawValue);
    }
  }
  return values;
}

function requiredValues(source, environment, names) {
  const fileValues = dotenvValues(source, names);
  const values = {};
  for (const name of names) {
    const value = stringValue(environment[name]) ?? stringValue(fileValues[name]);
    if (value === undefined) throw new Error(`Missing public production configuration: ${name}`);
    values[name] = value;
  }
  return values;
}

function httpsOrigin(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS origin`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`${name} must be an absolute HTTPS origin`);
  }
  return parsed.origin;
}

export function validatePublicProductionConfig(values) {
  const railwayIdentifier = (name) => {
    const value = values[name];
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`${name} contains unsupported characters`);
    return value;
  };
  return {
    webUrl: httpsOrigin("PRODUCTION_WEB_URL", values.PRODUCTION_WEB_URL),
    apiUrl: httpsOrigin("PRODUCTION_API_URL", values.PRODUCTION_API_URL),
    railwayProjectId: railwayIdentifier("RAILWAY_PROJECT_ID"),
    railwayEnvironment: railwayIdentifier("RAILWAY_ENVIRONMENT"),
    railwayApiService: railwayIdentifier("RAILWAY_API_SERVICE"),
    railwayJobsService: railwayIdentifier("RAILWAY_JOBS_SERVICE"),
  };
}

export function parsePublicProductionConfig(source, environment = {}) {
  return validatePublicProductionConfig(requiredValues(source, environment, publicProductionConfigNames));
}

export function parseProductionCutoverConfig(source, environment = {}) {
  const regionAlias = requiredValues(source, environment, ["RAILWAY_PRODUCTION_REGION_ALIAS"])
    .RAILWAY_PRODUCTION_REGION_ALIAS;
  if (!RAILWAY_REGION_ALIASES.includes(regionAlias)) {
    throw new Error(`RAILWAY_PRODUCTION_REGION_ALIAS must be one of: ${RAILWAY_REGION_ALIASES.join(", ")}`);
  }
  return { ...parsePublicProductionConfig(source, environment), railwayRegionAlias: regionAlias };
}

export async function loadProductionConfig(parseConfig, projectRoot, environment = process.env) {
  const configPath = environment.PRODUCTION_VERIFY_CONFIG ?? resolve(projectRoot, ".env.production.local");
  try {
    return parseConfig(await readFile(configPath, "utf8"), environment);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Public production configuration could not be read");
  }
}
