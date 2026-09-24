#!/usr/bin/env node
/**
 * Local stand-in for an agent that writes release notes.
 *
 * The harness runs it in a clean work dir with the task text in
 * `.eval-input.txt`; whatever files it leaves behind are its deliverable.
 * `--mode sloppy` drops a pull request and the breaking-changes section, which
 * the required check is there to catch.
 */
import fs from "node:fs";

const sloppy = process.argv.includes("--mode") && process.argv[process.argv.indexOf("--mode") + 1] === "sloppy";
const task = fs.readFileSync(".eval-input.txt", "utf8");
const prs = [...task.matchAll(/^#(\d+) (\w+)(!?): (.+)$/gm)].map(([, id, kind, bang, title]) => ({ id, kind, isBreaking: bang === "!", title }));

const kept = sloppy ? prs.slice(0, -1) : prs;
const section = (heading, items) =>
  items.length === 0 ? "" : `## ${heading}\n\n${items.map((p) => `- ${p.title} (#${p.id})`).join("\n")}\n\n`;

const notes =
  "# v2.4.0\n\n" +
  section("Features", kept.filter((p) => p.kind === "feat" && (sloppy || !p.isBreaking))) +
  section("Fixes", kept.filter((p) => p.kind === "fix")) +
  (sloppy ? "" : section("Breaking changes", kept.filter((p) => p.isBreaking)));

fs.writeFileSync("RELEASE_NOTES.md", notes);
console.log(`wrote RELEASE_NOTES.md (${kept.length} PRs)`);
