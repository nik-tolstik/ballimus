import "reflect-metadata";

import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { API_CONFIG, type ApiConfig } from "./config/api-config.module.js";
import { AppModule } from "./app.module.js";
import { setupOpenApi } from "./openapi.js";

export const API_CORS_ALLOWED_HEADERS = [
  "X-Telegram-Init-Data",
  "Idempotency-Key",
  "If-Match",
  "Content-Type",
] as const;

export async function createApiApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const apiConfig = app.get<ApiConfig>(API_CONFIG);

  app.setGlobalPrefix("v1", {
    exclude: ["health", "cron"],
  });
  app.enableCors({
    allowedHeaders: [...API_CORS_ALLOWED_HEADERS],
    credentials: false,
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, origin?: boolean | string | RegExp) => void,
    ) => {
      callback(null, requestOrigin === apiConfig.webOrigin);
    },
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
  setupOpenApi(app);

  return app;
}

function safeStartupMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";

  let message = error.message;
  for (const name of [
    "DATABASE_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_OWNER_USER_ID",
    "TELEGRAM_CHAT_ID",
    "TELEGRAM_GENERAL_TOPIC_ID",
    "TELEGRAM_CHAT_TOPIC_ID",
    "TELEGRAM_MINI_APP_URL",
    "WEB_ORIGIN",
  ]) {
    const value = process.env[name];
    if (value !== undefined && value !== "") message = message.split(value).join("[REDACTED]");
  }
  return message;
}

export async function bootstrap(): Promise<void> {
  try {
    const app = await createApiApplication();
    const apiConfig = app.get<ApiConfig>(API_CONFIG);
    await app.listen(apiConfig.port, "0.0.0.0");
  } catch (error: unknown) {
    console.error(`Football API startup failed: ${safeStartupMessage(error)}`);
    process.exitCode = 1;
  }
}
