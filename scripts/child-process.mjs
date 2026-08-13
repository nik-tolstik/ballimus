export function createChildProcessInvocation(
  command,
  argumentsToRun,
  platform = process.platform,
  commandShell = process.env.ComSpec ?? "cmd.exe",
) {
  if (platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      command: commandShell,
      arguments: ["/d", "/s", "/c", command, ...argumentsToRun],
    };
  }

  return { command, arguments: argumentsToRun };
}
