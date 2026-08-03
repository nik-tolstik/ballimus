import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";

export const TELEGRAM_MINI_APP_SECURITY_SCHEME = "telegramMiniApp" as const;
export const PUBLIC_OPENAPI_PATH = "docs" as const;
export const PUBLIC_OPENAPI_JSON_PATH = "docs-json" as const;

const EXCLUDED_PUBLIC_PATHS = new Set(["/health", "/telegram/webhook", "/cron"]);

function isExcludedPublicPath(path: string): boolean {
  const withoutVersionPrefix = path.replace(/^\/v1(?=\/|$)/, "");
  return (
    EXCLUDED_PUBLIC_PATHS.has(withoutVersionPrefix) ||
    withoutVersionPrefix.startsWith("/cron/") ||
    withoutVersionPrefix.startsWith("/telegram/webhook/")
  );
}

export function filterPublicOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  const paths = Object.fromEntries(
    Object.entries(document.paths).filter(([path]) => !isExcludedPublicPath(path)),
  );
  return { ...document, paths };
}

export function createPublicOpenApiDocument(app: INestApplication): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle("Football Bot API")
    .setDescription("Owner-facing REST API for the Football Telegram Mini App.")
    .setVersion("1.0.0")
    .addSecurity(TELEGRAM_MINI_APP_SECURITY_SCHEME, {
      type: "apiKey",
      in: "header",
      name: "X-Telegram-Init-Data",
      description: "Raw Telegram.WebApp.initData. The server validates its HMAC and owner identity.",
    })
    .build();

  const document = SwaggerModule.createDocument(app, options, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
  });
  return filterPublicOpenApiDocument(document);
}

export function setupOpenApi(app: INestApplication): void {
  const document = createPublicOpenApiDocument(app);
  SwaggerModule.setup(PUBLIC_OPENAPI_PATH, app, document, {
    jsonDocumentUrl: PUBLIC_OPENAPI_JSON_PATH,
  });
}

const OPENAPI_FIXTURE_ENVIRONMENT: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://openapi:openapi@localhost:5432/openapi",
  TELEGRAM_BOT_TOKEN: "123456:openapi-fixture-token",
  TELEGRAM_WEBHOOK_SECRET: "openapi-fixture-secret",
  TELEGRAM_OWNER_USER_ID: "1",
  TELEGRAM_CHAT_ID: "-1001234567890",
  TELEGRAM_GENERAL_TOPIC_ID: "1",
  TELEGRAM_CHAT_TOPIC_ID: "2",
  TELEGRAM_MINI_APP_URL: "https://mini-app.invalid/",
  WEB_ORIGIN: "https://mini-app.invalid",
  LOG_LEVEL: "info",
  PORT: "6000",
};

function ensureOpenApiEnvironment(): void {
  for (const [name, value] of Object.entries(OPENAPI_FIXTURE_ENVIRONMENT)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

export async function writeOpenApiDocument(
  outputPath = process.env["OPENAPI_OUTPUT"] ?? resolve(process.cwd(), "openapi.json"),
): Promise<string> {
  ensureOpenApiEnvironment();
  const { createApiApplication } = await import("./bootstrap.js");
  const app = await createApiApplication();

  try {
    const document = createPublicOpenApiDocument(app);
    const absoluteOutputPath = resolve(outputPath);
    await mkdir(dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return absoluteOutputPath;
  } finally {
    await app.close();
  }
}

if (process.argv.includes("--write")) {
  void writeOpenApiDocument().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`OpenAPI generation failed: ${message}`);
    process.exitCode = 1;
  });
}
