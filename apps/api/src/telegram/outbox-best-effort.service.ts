import { Inject, Injectable } from "@nestjs/common";
import { OutboxRepository, type AppDatabase } from "@football/db";

import { APP_DATABASE } from "../database/database.constants.js";
import { OutboxDispatcher } from "../jobs/outbox.dispatcher.js";

/** Performs a small post-commit delivery attempt while Cron remains the durable recovery path. */
@Injectable()
export class OutboxBestEffortService {
  public constructor(
    @Inject(APP_DATABASE) private readonly db: AppDatabase,
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
  ) {}

  public async dispatch(limit = 3): Promise<number> {
    const events = await new OutboxRepository(this.db).claim({ limit, leaseDurationMs: 30_000 });
    for (const event of events) await this.dispatcher.dispatch(event);
    return events.length;
  }
}
