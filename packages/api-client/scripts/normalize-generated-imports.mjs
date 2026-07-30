import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const generatedRoot = resolve(process.env.GENERATED_ROOT ?? "src/generated");

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
    } else if (entry.isFile() && extname(entry.name) === ".ts") {
      files.push(entryPath);
    }
  }

  return files;
}

async function resolveImportPath(sourceFile, importPath) {
  if (importPath.endsWith("/mutator") || importPath.endsWith("/mutator.ts")) {
    return "../../mutator.js";
  }
  const absoluteImportPath = resolve(dirname(sourceFile), importPath);
  const candidates = [
    [`${absoluteImportPath}.ts`, ".js"],
    [absoluteImportPath, ".js"],
    [join(absoluteImportPath, "index.ts"), "/index.js"],
  ];

  for (const [candidate, suffix] of candidates) {
    try {
      const candidateStats = await stat(candidate);
      if (candidateStats.isFile()) return `${importPath}${suffix}`;
    } catch {
      // The generated import is external or intentionally unresolved.
    }
  }

  return importPath;
}

const files = await collectTypeScriptFiles(generatedRoot);
const importPattern = /(\bfrom\s+["']|\bimport\s*["'])(\.[^"']+)(["'])/gu;

for (const file of files) {
  const original = await readFile(file, "utf8");
  const rewritten = [];
  let cursor = 0;

  for (const match of original.matchAll(importPattern)) {
    const sourceStart = match.index + match[1].length;
    const sourceEnd = sourceStart + match[2].length;
    rewritten.push(original.slice(cursor, sourceStart));
    rewritten.push(await resolveImportPath(file, match[2]));
    cursor = sourceEnd;
  }

  rewritten.push(original.slice(cursor));
  const next = rewritten
    .join("")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n+$/u, "\n");
  if (next !== original) await writeFile(file, next, "utf8");
}

console.log(`Normalized ${files.length} generated TypeScript files.`);
