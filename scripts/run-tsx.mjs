#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const environment = { ...process.env };

if (process.platform === "linux") {
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    if (environment[name]?.startsWith("/mnt/")) delete environment[name];
  }
}

const child = spawn(process.execPath, [tsxCli, ...process.argv.slice(2)], {
  env: environment,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
