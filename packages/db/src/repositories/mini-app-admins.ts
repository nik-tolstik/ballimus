import { eq, ne } from "drizzle-orm";

import { miniAppAdmins } from "../schema.js";
import { repositoryCall, type DatabaseExecutor } from "./common.js";

export class MiniAppAdminsRepository {
  public constructor(private readonly db: DatabaseExecutor) {}

  public async has(telegramUserId: bigint): Promise<boolean> {
    const rows = await repositoryCall("find Mini App admin", async () =>
      this.db.select().from(miniAppAdmins).where(eq(miniAppAdmins.telegramUserId, telegramUserId)),
    );
    return rows.length > 0;
  }

  public async list(ownerId: bigint): Promise<bigint[]> {
    const rows = await repositoryCall("list Mini App admins", async () =>
      this.db.select().from(miniAppAdmins).where(ne(miniAppAdmins.telegramUserId, ownerId)).orderBy(miniAppAdmins.telegramUserId),
    );
    return rows.map(({ telegramUserId }) => telegramUserId);
  }

  public async grant(telegramUserId: bigint): Promise<void> {
    await repositoryCall("grant Mini App admin access", async () =>
      this.db.insert(miniAppAdmins).values({ telegramUserId }).onConflictDoNothing(),
    );
  }

  public async revoke(telegramUserId: bigint): Promise<void> {
    await repositoryCall("revoke Mini App admin access", async () =>
      this.db.delete(miniAppAdmins).where(eq(miniAppAdmins.telegramUserId, telegramUserId)),
    );
  }
}
