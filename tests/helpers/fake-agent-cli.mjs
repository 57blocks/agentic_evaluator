#!/usr/bin/env node
/**
 * Deterministic stand-in for an agent CLI. Reads `.eval-input.txt` from cwd,
 * writes `src/index.ts`, and optionally records leftover argv in `args.txt`.
 *
 * Usage: fake-agent-cli.mjs [--mode ok|fail] [extra...]
 */
import fs from "node:fs";
import path from "node:path";

let argv = process.argv.slice(2);
let mode = process.env.FAKE_AGENT_MODE ?? "ok";
if (argv[0] === "--mode") {
  mode = argv[1] ?? mode;
  argv = argv.slice(2);
}

const workDir = process.cwd();
const inputPath = path.join(workDir, ".eval-input.txt");
const input = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, "utf8") : "";

if (mode === "fail") {
  console.error("fake agent refused the task");
  process.exit(2);
}

if (argv.length > 0) {
  fs.writeFileSync(path.join(workDir, "args.txt"), argv.join("\n"), "utf8");
}

fs.mkdirSync(path.join(workDir, "src"), { recursive: true });
fs.writeFileSync(path.join(workDir, "src", "index.ts"), `export const inputLen = ${input.length};\n`, "utf8");
console.log("ok");
