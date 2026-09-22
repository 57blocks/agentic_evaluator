/**
 * Parity: did a change to the harness move the numbers?
 *
 * Borrowed from Harbor's adapters/parity_summary.csv, where an adapter must
 * show that a converted benchmark still reproduces the original's reported
 * score before it is merged. The same question applies to us, one level
 * down: after moving every task into its own directory, changing how assets
 * resolve, or wiring a new check, are we still measuring the same thing?
 *
 * A run's own manifest already proves one configuration is reproducible.
 * This proves something the manifest cannot: that the harness itself did not
 * shift underneath a fixed configuration.
 *
 *   pnpm run parity capture before tasks/smoke-codegen/spec.yaml   # n runs
 *   <make the change>
 *   pnpm run parity capture after  tasks/smoke-codegen/spec.yaml
 *   pnpm run parity compare before after                           # -> parity.csv
 *
 * `capture` reads runs that already exist — it never spends. Produce them
 * with `pnpm run run -- --suite <spec> --yes` as usual.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { listRunDirs, REPO_ROOT } from "../src/paths.js";

const PARITY_DIR = path.join(REPO_ROOT, "parity");

interface TrialRow {
  step: string;
  candidate: string;
  input: string;
  completion_state: string;
  task_outcome: string;
}

interface Arm {
  label: string;
  spec: string;
  runIds: string[];
  /** Success rate per run, in run order. */
  rates: number[];
  trials: number;
}

async function readTrials(dir: string): Promise<TrialRow[]> {
  const out: TrialRow[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else if (e.name === "scores.jsonl") {
        const text = await fs.readFile(path.join(d, e.name), "utf-8");
        for (const line of text.split("\n")) {
          if (line.trim() === "") continue;
          try {
            out.push(JSON.parse(line) as TrialRow);
          } catch {
            // A truncated line is not a measurement.
          }
        }
      }
    }
  };
  await walk(dir);
  return out;
}

/**
 * The headline metric: share of trials whose task_outcome is success.
 *
 * `undetermined` counts against it deliberately — a step with no
 * deterministic check cannot claim success, and hiding that in the
 * denominator is the arithmetic this protocol exists to refuse.
 */
function successRate(rows: readonly TrialRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.filter((r) => r.task_outcome === "success").length / rows.length;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Every run of `spec`, newest first. */
async function runsOf(spec: string): Promise<{ id: string; dir: string }[]> {
  const taskName = path.basename(path.dirname(spec));
  return (await listRunDirs())
    .filter((e) => e.task === taskName)
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((e) => ({ id: e.name, dir: e.dir }));
}

async function capture(label: string, spec: string, take: number): Promise<void> {
  const runs = (await runsOf(spec)).slice(0, take);
  if (runs.length === 0) {
    console.error(`No runs found for ${spec}. Run it first — capture never spends.`);
    process.exit(1);
  }
  const rates: number[] = [];
  let trials = 0;
  for (const r of runs) {
    const rows = await readTrials(r.dir);
    const rate = successRate(rows);
    if (rate === null) continue;
    rates.push(rate);
    trials += rows.length;
  }
  const arm: Arm = { label, spec, runIds: runs.map((r) => r.id), rates, trials };
  await fs.mkdir(PARITY_DIR, { recursive: true });
  await fs.writeFile(path.join(PARITY_DIR, `${label}.json`), JSON.stringify(arm, null, 2));
  console.log(
    `✔ ${label}: ${rates.length} runs, ${trials} trials, ` +
      `success ${(mean(rates) * 100).toFixed(1)}% ± ${(stdev(rates) * 100).toFixed(1)}`,
  );
}

async function compare(a: string, b: string): Promise<void> {
  const read = async (l: string) =>
    JSON.parse(await fs.readFile(path.join(PARITY_DIR, `${l}.json`), "utf-8")) as Arm;
  const before = await read(a);
  const after = await read(b);

  const rows = [
    [
      "spec", "metric", "parity between",
      "before mean", "before std", "before runs",
      "after mean", "after std", "after runs",
      "delta", "trials",
    ].join(","),
    [
      before.spec,
      "task_outcome success rate",
      `${a} x ${b}`,
      mean(before.rates).toFixed(4), stdev(before.rates).toFixed(4), before.rates.length,
      mean(after.rates).toFixed(4), stdev(after.rates).toFixed(4), after.rates.length,
      (mean(after.rates) - mean(before.rates)).toFixed(4),
      `${before.trials}/${after.trials}`,
    ].join(","),
  ].join("\n");

  const out = path.join(PARITY_DIR, "parity.csv");
  await fs.writeFile(out, `${rows}\n`);
  console.log(rows);

  // Two runs each is not a significance test, so say what this does show.
  const delta = Math.abs(mean(after.rates) - mean(before.rates));
  const noise = Math.max(stdev(before.rates), stdev(after.rates));
  console.log(
    `\n→ ${path.relative(REPO_ROOT, out)}` +
      `\n  delta ${(delta * 100).toFixed(1)}pp against a run-to-run spread of ` +
      `${(noise * 100).toFixed(1)}pp.` +
      (delta <= noise
        ? "\n  Within the spread — directional evidence that nothing moved, not proof."
        : "\n  Larger than the spread. Something moved; find out what before shipping."),
  );
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "capture") {
    const [label, spec, take] = rest;
    if (!label || !spec) throw new Error("usage: parity capture <label> <spec> [runs]");
    await capture(label, spec, Number(take ?? 3));
  } else if (cmd === "compare") {
    const [a, b] = rest;
    if (!a || !b) throw new Error("usage: parity compare <before> <after>");
    await compare(a, b);
  } else {
    console.error("usage: parity capture <label> <spec> [runs] | parity compare <before> <after>");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
