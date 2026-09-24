/**
 * The `--models` scaffold for `agenteval init`: a small, real evaluation.
 *
 * Two cheap models from different vendors write one TypeScript function; the
 * compiler gates them and a judge from a third vendor compares the survivors
 * pairwise. It needs OPENROUTER_API_KEY and costs about a cent — the budget
 * is set low enough that the ceiling itself is part of what it shows.
 */

import path from "node:path";

const SPEC = (name: string): string => `# ${name} — created by \`agenteval init --models\`.
#
# A small, real evaluation: two cheap models write the function in
# inputs/slugify.txt, \`tsc\` gates what they wrote, and a judge from a third
# vendor compares the ones that compile. Needs OPENROUTER_API_KEY; one run
# costs about a cent, and budget_usd stops it well before a dollar.
#
#   agenteval models ${name} --catalog-only   # ids and prices, free
#   agenteval plan ${name}                    # call counts, free
#   agenteval run ${name} --yes --html        # billed
#
# The recommendation comes from the gates and the operating mode; the judge's
# preference is reported beside it. To let the judge decide, set
# \`operating_mode: judge-preference\` (the verdict is then at most directional).

protocol_version: "0.3"
run_name: ${name}
budget_usd: 0.05

workflow:
  control_candidate: deepseek-flash
  steps:
    - id: main
      version: "1"
      test_set:
        id: ${name}-v1
        inputs: [slugify]
      candidate_ids: [deepseek-flash, gpt-5-nano]
      required_checks: [tsc-noemit]
      judged_dimensions: [meets-spec, correctness, type-quality, simplicity]
      success_criteria:
        mandatory_checks: all
      operating_mode: lowest-cost
      eligibility:
        minimum_reliability: 1.0
        minimum_required_check_pass_rate: 1.0
      maximum_completion_time_seconds: 120

candidates:
  - id: deepseek-flash
    model: deepseek/deepseek-v4-flash
    provider_route: openrouter
    generation_settings: { temperature: 0.2 }
  - id: gpt-5-nano
    model: openai/gpt-5-nano
    provider_route: openrouter
    generation_settings: { temperature: 0.2 }

evaluators:
  required_checks:
    tsc-noemit:
      kind: tsc
      scaffold_dir: scaffold
  judge:
    # A different vendor from every candidate: a judge preferring its own
    # vendor's output is a bias the loader refuses to allow.
    model: google/gemini-2.5-flash
    provider_route: openrouter
    rubric_file: rubrics/main.md
    methods: [pairwise-swap]

execution:
  trials_per_case: 1
  concurrency: 2

x-harness:
  producer: codegen
  default_temperature: 0.2
`;

const INPUT = `Write \`slugify(title: string): string\` in \`slugify.ts\`, exported.

- Lowercase the result.
- Replace every run of characters that are not a-z or 0-9 with a single \`-\`.
- Remove any leading or trailing \`-\`.
- Return an empty string when the title has no letters or digits.

Examples:
- slugify("Hello, World!") === "hello-world"
- slugify("  Déjà vu -- 2024  ") === "d-j-vu-2024"
- slugify("***") === ""
`;

const RUBRIC = (name: string): string => `# ${name} rubric

Judge two submissions for the same small TypeScript task. Whether the code
compiles is measured separately by \`tsc\`; judge the code itself.

1. **meets-spec** — the exact name, signature and file the task asked for,
   and every rule and example it states.
2. **correctness** — right on the edge cases: runs of separators, leading and
   trailing separators, non-ASCII letters, a title with nothing to keep.
3. **type-quality** — precise types, no \`any\`, no casts to dodge the checker.
4. **simplicity** — the smallest clear implementation; no unrequested
   options or cleverness.

Prefer the submission that meets the spec correctly with the least code.
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

const README = (name: string): string => `# Task: ${name}

A small, real evaluation: two models, a compiler gate, a judge.

\`\`\`bash
export OPENROUTER_API_KEY=sk-or-...
agenteval plan ${name}                # what a run would do, free
agenteval run ${name} --yes --html    # about a cent
\`\`\`

- \`spec.yaml\` — the versioned source of truth: candidates, check, judge, budget
- \`inputs/slugify.txt\` — the task every candidate sees
- \`rubrics/main.md\` — what the judge compares, one numbered item per dimension
- \`scaffold/\` — the tsconfig the \`tsc\` check compiles against
- \`runs/\` — evidence, written beside the definition that produced it

Swap the models in \`candidates\`, add inputs, or raise \`trials_per_case\`
before trusting a ranking: with one input every result is directional.
`;

/** Files of the `--models` scaffold, relative to the task directory. */
export function modelsTaskFiles(name: string): Array<[string, string]> {
  return [
    ["spec.yaml", SPEC(name)],
    ["README.md", README(name)],
    [path.join("inputs", "slugify.txt"), INPUT],
    [path.join("rubrics", "main.md"), RUBRIC(name)],
    [path.join("scaffold", "tsconfig.json"), TSCONFIG],
  ];
}
