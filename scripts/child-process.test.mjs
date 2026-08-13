import assert from "node:assert/strict";
import test from "node:test";

import { createChildProcessInvocation } from "./child-process.mjs";

test("runs Windows command wrappers through cmd.exe", () => {
  assert.deepEqual(createChildProcessInvocation("pnpm.cmd", ["--version"], "win32", "cmd.exe"), {
    command: "cmd.exe",
    arguments: ["/d", "/s", "/c", "pnpm.cmd", "--version"],
  });
  assert.deepEqual(createChildProcessInvocation("PNPM.CMD", [], "win32", "cmd.exe"), {
    command: "cmd.exe",
    arguments: ["/d", "/s", "/c", "PNPM.CMD"],
  });
  assert.deepEqual(createChildProcessInvocation("pnpm", ["--version"], "win32", "cmd.exe"), {
    command: "pnpm",
    arguments: ["--version"],
  });
  assert.deepEqual(createChildProcessInvocation("pnpm.cmd", ["--version"], "linux"), {
    command: "pnpm.cmd",
    arguments: ["--version"],
  });
});
