import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";

import { AppModule } from "../app.module.js";
import { JobsRunner } from "./jobs.runner.js";

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim() === "") return "unknown error";
  return error.message;
}

async function runJobs(): Promise<void> {
  let app: INestApplicationContext | undefined;
  let failed = false;

  try {
    app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
    const result = await app.get(JobsRunner).runOnce();

    if (result.status === "busy") {
      console.log("Jobs run skipped: another run holds the lease.");
    } else {
      const { summary } = result;
      console.log(
        `Jobs run completed: claimed=${summary.claimed} delivered=${summary.delivered} failed=${summary.failed} uncertain=${summary.uncertain} weatherSent=${summary.weather.sent} weatherFailed=${summary.weather.failed}`,
      );
    }
  } catch (error: unknown) {
    failed = true;
    console.error(`Jobs run failed: ${safeErrorMessage(error)}`);
  } finally {
    if (app !== undefined) {
      try {
        await app.close();
      } catch (error: unknown) {
        failed = true;
        console.error(`Jobs run cleanup failed: ${safeErrorMessage(error)}`);
      }
    }
  }

  if (failed) process.exitCode = 1;
}

void runJobs();
