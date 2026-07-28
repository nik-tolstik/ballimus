import { createDatabaseClient } from "./client.js";

const client = createDatabaseClient({ migrate: true });
client.close();
