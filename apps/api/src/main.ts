import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { bootstrap } from "./bootstrap.js";

export { bootstrap } from "./bootstrap.js";
export { createApiApplication } from "./bootstrap.js";

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);

if (entryFile === currentFile) void bootstrap();
