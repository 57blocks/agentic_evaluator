/**
 * `agenteval init <name>` — a task you can actually run, immediately.
 *
 * The default scaffold is a working check-only task, not a template with
 * holes: two command candidates, a required check, and no judging method
 * declared. It runs offline the moment it is created, which is the point —
 * the first thing a new user should see is the pipeline working, not a spec
 * that needs four more decisions before it does anything, or a key.
 *
 * `--models` writes the real thing instead (see init-models.ts): two models,
 * the same kind of gate, and a judge. It needs a key and costs about a cent.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { findWorkspace, tasksDir, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { modelsTaskFiles } from "./init-models.js";

export const INIT_HELP = `agenteval init <name> [options]

  Create tasks/<name>/ — a runnable task to edit.

  By default it is offline and free: two local stand-in candidates and a
  tsc check, no model calls.

  --models            a small real evaluation instead: two cheap models, a
                      tsc check and a judge from a third vendor. Needs
                      OPENROUTER_API_KEY; about a cent per run
  --workspace DIR     workspace to create it in
  --force             overwrite an existing task of that name`;

const SPEC = (name: string): string => `# ${name} — created by \`agenteval init\`.
#
# Runnable as-is, offline: both candidates are local commands and no judging
# method is declared, so nothing is billed. Replace the candidates with models
# and add \`methods: [pairwise-swap]\` when you want a judge, or start from
# \`agenteval init <name> --models\`, which does both.

protocol_version: "0.3"
run_name: ${name}
budget_usd: 1

workflow:
  control_candidate: baseline
  steps:
    - id: main
      version: "1"
      test_set:
        id: ${name}-v1
        inputs: [example]
      candidate_ids: [baseline, variant]
      required_checks: [tsc-noemit]
      judged_dimensions: []
      success_criteria:
        mandatory_checks: all
      operating_mode: lowest-cost
      eligibility:
        minimum_reliability: 1.0
        minimum_required_check_pass_rate: 1.0
      maximum_completion_time_seconds: 60

candidates:
  - id: baseline
    adapter: agent-cli
    cli:
      argv: [node, agents/example.mjs]
  - id: variant
    adapter: agent-cli
    cli:
      argv: [node, agents/example.mjs, --mode, fail]

evaluators:
  required_checks:
    tsc-noemit:
      kind: tsc
      scaffold_dir: scaffold
  judge:
    # Declared because the schema requires one; never called, because no
    # method is declared. GAPS.md will say so rather than leave a blank.
    model: google/gemini-3.1-pro-preview
    provider_route: openrouter
    rubric_file: rubrics/main.md
    methods: []

execution:
  trials_per_case: 1
  concurrency: 2

x-harness:
  producer: codegen
  default_temperature: 0.2
`;

const AGENT = `#!/usr/bin/env node
/**
 * Stand-in candidate. Writes one TypeScript file into the work directory so
 * the required check has something to compile. \`--mode fail\` writes code
 * that does not type-check, so the two candidates differ on the check alone.
 */
import fs from "node:fs";

const fail = process.argv.includes("fail");
const source = fail
  ? "export function add(a: number, b: number): number {\\n  return \\"nope\\";\\n}\\n"
  : "export function add(a: number, b: number): number {\\n  return a + b;\\n}\\n";
fs.writeFileSync("add.ts", source);
process.stdout.write(fail ? "wrote a deliberate type error\\n" : "ok\\n");
`;

const TSCONFIG = `{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true
  },
  "include": ["*.ts"]
}
`;

const RUBRIC = (name: string): string => `# ${name} rubric

Numbered items here become the dimensions a judge scores, one verdict each.
This task declares no judging method, so nothing reads this file yet.

1. **meets-spec** — does the output do what the input asked for?
2. **correctness** — is it right on the cases the input names?
`;

const INPUT = `Write a function \`add(a: number, b: number): number\` that returns their sum.
`;

const README = (name: string): string => `# Task: ${name}

\`\`\`bash
agenteval plan ${name}          # what a run would cost
agenteval run ${name} --yes     # run it (offline, free, as created)
\`\`\`

- \`spec.yaml\` — the versioned source of truth for this task
- \`inputs/\` — the frozen inputs every candidate sees
- \`rubrics/\` — what a judge would score, one numbered item per dimension
- \`agents/\` — local command candidates; a task owns its agents
- \`scaffold/\` — the tsconfig the required check compiles against
- \`runs/\` — evidence, written beside the definition that produced it
`;

export async function cmdInit(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["workspace", "force", "models"]);
  const name = args.positional[0];
  if (name === undefined) throw new UsageError("name the task: agenteval init <name>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new UsageError(`"${name}" is not a task name (lowercase letters, digits and dashes)`);
  }

  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const root = path.join(tasksDir(ws), name);
  const exists = await fs.stat(root).then(() => true).catch(() => false);
  if (exists && args.flags.force !== true) {
    throw new UsageError(`${root} already exists (use --force to overwrite)`);
  }

  const withModels = args.flags.models === true;
  const files: Array<[string, string]> = withModels ? modelsTaskFiles(name) : [
    ["spec.yaml", SPEC(name)],
    ["README.md", README(name)],
    [path.join("agents", "example.mjs"), AGENT],
    [path.join("inputs", "example.txt"), INPUT],
    [path.join("rubrics", "main.md"), RUBRIC(name)],
    [path.join("scaffold", "tsconfig.json"), TSCONFIG],
  ];
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }

  const next = withModels
    ? `  agenteval plan ${name}          # free: what a run would do\n  agenteval run ${name} --yes     # needs OPENROUTER_API_KEY, about a cent\n`
    : `  agenteval run ${name} --yes\n`;
  io.out(`created ${root}\n${next}`);
  return EXIT.ok;
}
