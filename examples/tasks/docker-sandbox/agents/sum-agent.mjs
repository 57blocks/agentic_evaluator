#!/usr/bin/env node
/**
 * Local stand-in for an agent: sums the numbers in the task and writes SUM.txt.
 *
 * It also writes ENVIRONMENT.json — whether it ran in a container, and there
 * whether it could see the task's checks/ — so the required check can put how the
 * candidate ran into the evidence. The same script is both candidates; only
 * the spec's `image:` differs.
 */
import fs from "node:fs";

const numbers = fs.readFileSync(".eval-input.txt", "utf8").trim().split(/\s+/).map(Number);
fs.writeFileSync("SUM.txt", String(numbers.reduce((a, b) => a + b, 0)));
fs.writeFileSync(
  "ENVIRONMENT.json",
  JSON.stringify({
    inContainer: fs.existsSync("/.dockerenv"),
    // Inside a container only the task directories this command names are
    // mounted (under /task); checks/ should not be among them.
    sawChecks: fs.existsSync("/task/checks"),
    node: process.version,
  }),
);
console.log(`summed ${numbers.length} numbers`);
