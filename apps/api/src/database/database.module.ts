import { Global, Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import {
  createDatabaseClient,
  type AppDatabase,
  type DatabaseClient,
} from "@football/db";

import { API_CONFIG, ApiConfigModule, type ApiConfig } from "../config/api-config.module.js";
import { APP_DATABASE, APP_DATABASE_CLIENT } from "./database.constants.js";

const databaseClientProvider = {
  provide: APP_DATABASE_CLIENT,
  inject: [API_CONFIG],
  useFactory: (config: ApiConfig): DatabaseClient =>
    createDatabaseClient({ url: config.databaseUrl }),
};

const appDatabaseProvider = {
  provide: APP_DATABASE,
  inject: [APP_DATABASE_CLIENT],
  useFactory: (client: DatabaseClient): AppDatabase => client.db,
};

/** Closes the one client created by the module when Nest shuts down. */
@Injectable()
export class DatabaseShutdown implements OnModuleDestroy {
  public constructor(
    @Inject(APP_DATABASE_CLIENT) private readonly client: DatabaseClient,
  ) {}

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Shared PostgreSQL access for API feature modules.
 *
 * The database package only opens the client here. Migrations are deliberately
 * left to the deployment release step and never run during Nest startup.
 */
@Global()
@Module({
  imports: [ApiConfigModule],
  providers: [databaseClientProvider, appDatabaseProvider, DatabaseShutdown],
  exports: [APP_DATABASE, APP_DATABASE_CLIENT],
})
export class DatabaseModule {}

export { APP_DATABASE, APP_DATABASE_CLIENT } from "./database.constants.js";
export type { AppDatabaseClient } from "./database.constants.js";
