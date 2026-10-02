// `cf previews deploy`, plus the output-file entry Workers Builds reads the Preview URL from.
// Workers Builds shows a Preview's URL on the PR from the entry `wrangler preview` appends to
// `$WRANGLER_OUTPUT_FILE_DIRECTORY` (or `$WRANGLER_OUTPUT_FILE_PATH`); cf (through 1.0.0-beta.10) prints the
// same JSON to stdout but writes no file, so the PR comment says "No Preview URL". This writes
// cf's result in that format. Delete it once cf writes the file itself (friction log, 1.6.1).
// Builds' Preview deploy command: `node scripts/cf-previews-deploy.ts`; extra args go to cf.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const stdout = execFileSync(
  "pnpm",
  ["exec", "cf", "previews", "deploy", ...process.argv.slice(2)],
  {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);
process.stdout.write(stdout);

function outputFilePath(): string | null {
  const path = process.env.WRANGLER_OUTPUT_FILE_PATH;
  if (path) return path;
  const dir = process.env.WRANGLER_OUTPUT_FILE_DIRECTORY;
  if (!dir) return null;
  const date = new Date().toISOString().replaceAll(":", "-").replace(".", "_").replace("T", "_");
  return resolve(
    dir,
    `wrangler-output-${date.replace("Z", "")}-${randomBytes(3).toString("hex")}.json`,
  );
}

const file = outputFilePath();
if (file === null) {
  console.log("cf-previews-deploy: no WRANGLER_OUTPUT_FILE_* set, nothing to write");
} else {
  // Color codes appear when FORCE_COLOR is set (some shells and agents set it); strip them.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes on purpose
  const json = stdout.replace(/\x1b\[[0-9;]*m/g, "");
  const result = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  const timestamp = new Date().toISOString();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ worker_name: "stag", ...result, timestamp })}\n`);
  console.log(`cf-previews-deploy: wrote the Preview entry to ${file}`);
}
