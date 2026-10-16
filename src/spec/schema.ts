/**
 * JSON Schema for the protocol-style evaluation spec (YAML on disk).
 *
 * Kept as a plain object (not a .json import) so it type-checks with the
 * loader. Only fields the
 * v0.4 protocol names plus one `x-harness` extension block for producer details
 * the protocol deliberately leaves to implementations.
 */

/** The protocol version a spec must declare; the dashboard shows the same value. */
export const PROTOCOL_VERSION = "0.3";

export const SPEC_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://57blocks.com/agentic-evaluator/spec-v0.4.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["protocol_version", "run_name", "workflow", "candidates", "evaluators", "execution"],
  // Any other `x-` key is the spec author's (YAML anchors to share, notes):
  // never read by agenteval, so never rejected.
  patternProperties: { "^x-": {} },
  properties: {
    protocol_version: { type: "string", enum: [PROTOCOL_VERSION] },
    run_name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,63}$" },
    /** What this evaluation decides and tests, in a few sentences; the report opens with it. */
    description: { type: "string", minLength: 1 },
    budget_usd: { type: "number", minimum: 0 },
    workflow: {
      type: "object",
      additionalProperties: false,
      required: ["steps"],
      properties: {
        control_candidate: { type: "string" },
        e2e: {
          type: "object",
          additionalProperties: false,
          properties: {
            inputs: { type: "array", minItems: 1, items: { type: "string" } },
            final_checks: { type: "array", minItems: 1, items: { type: "string" } },
            judge: {
              type: "object",
              additionalProperties: false,
              required: ["rubric_file"],
              properties: {
                rubric_file: { type: "string", minLength: 1 },
                show: { type: "array", items: { type: "string", minLength: 1 } },
                dimensions: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "version", "test_set", "candidate_ids"],
            properties: {
              id: { type: "string" },
              version: { type: "string" },
              test_set: {
                type: "object",
                additionalProperties: false,
                required: ["id", "inputs"],
                properties: {
                  id: { type: "string" },
                  inputs: { type: "array", minItems: 1, items: { type: "string" } },
                  fixture_dir: { type: "string", minLength: 1 },
                  /** JSON, task-relative: { "<input>": { "tags": [...], "split": "dev" } }; the report breaks results down by it. */
                  labels_file: { type: "string", minLength: 1 },
                },
              },
              candidate_ids: { type: "array", minItems: 1, items: { type: "string" } },
              required_checks: { type: "array", items: { type: "string" } },
              judged_dimensions: { type: "array", items: { type: "string" } },
              success_criteria: {
                type: "object",
                additionalProperties: false,
                required: ["mandatory_checks"],
                properties: { mandatory_checks: { type: "string", enum: ["all"] } },
              },
              operating_mode: {
                type: "string",
                enum: [
                  "lowest-cost",
                  "fastest-within-cost-ceiling",
                  "highest-assurance",
                  "judge-preference",
                ],
              },
              eligibility: {
                type: "object",
                additionalProperties: false,
                properties: {
                  minimum_reliability: { type: "number", minimum: 0, maximum: 1 },
                  minimum_required_check_pass_rate: { type: "number", minimum: 0, maximum: 1 },
                  maximum_p95_ms: { type: "number", exclusiveMinimum: 0 },
                  cost_ceiling_per_success_usd: { type: "number", exclusiveMinimum: 0 },
                },
              },
              maximum_completion_time_seconds: { type: "number", exclusiveMinimum: 0 },
              max_cost_per_trial_usd: { type: "number", exclusiveMinimum: 0 },
              concurrency: { type: "integer", minimum: 1 },
              // This step's judging; the judge model stays evaluators.judge.model.
              judge: {
                type: "object",
                additionalProperties: false,
                properties: {
                  rubric_file: { type: "string", minLength: 1 },
                  methods: { type: "array", items: { type: "string", enum: ["pairwise-swap", "absolute-1-5"] } },
                  show: { type: "array", items: { type: "string", minLength: 1 } },
                  dimensions: { type: "array", items: { type: "string" } },
                },
              },
              producer: { type: "string", enum: ["prompt", "codegen"] },
              prompt_file: { type: "string" },
              rubric_file: { type: "string" },
              input_from: { type: "string" },
              handoff: { type: "string", enum: ["text", "workdir"] },
            },
          },
        },
      },
    },
    candidates: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9.-]*$" },
          adapter: { type: "string", enum: ["model-api", "codegen", "agent-cli"] },
          model: { type: "string" },
          provider_route: { type: "string" },
          price: {
            type: "object",
            additionalProperties: false,
            required: ["input", "output"],
            properties: {
              input: { type: "number", minimum: 0 },
              output: { type: "number", minimum: 0 },
              cache_read: { type: "number", minimum: 0 },
              cache_write: { type: "number", minimum: 0 },
            },
          },
          generation_settings: {
            type: "object",
            additionalProperties: false,
            properties: {
              temperature: { type: "number", minimum: 0, maximum: 2 },
              max_tokens: { type: "integer", minimum: 1 },
            },
          },
          cli: {
            type: "object",
            additionalProperties: false,
            required: ["argv"],
            properties: {
              argv: { type: "array", minItems: 1, items: { type: "string" } },
              env: { type: "object", additionalProperties: { type: "string" } },
              image: { type: "string", minLength: 1 },
              network: { type: "string", enum: ["none", "bridge"] },
              memory: { type: "string", minLength: 1 },
              cpus: { type: "string", minLength: 1 },
              reports_usage: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["tokens"] }] },
            },
          },
        },
      },
    },
    evaluators: {
      type: "object",
      additionalProperties: false,
      required: ["judge"],
      properties: {
        required_checks: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["tsc", "command"] },
              /** tsc only. */
              scaffold_dir: { type: "string" },
              /** command only: program + args, run in the trial work dir. */
              argv: { type: "array", minItems: 1, items: { type: "string" } },
              /** command only: files hashed into the evaluator version. */
              version_files: { type: "array", items: { type: "string" } },
              timeout_seconds: { type: "number", exclusiveMinimum: 0 },
              /** What a pass means, in one sentence; the report shows it beside the pass rate. */
              description: { type: "string", minLength: 1 },
            },
          },
        },
        human: {
          type: "object",
          additionalProperties: false,
          required: ["rubric_file"],
          properties: {
            rubric_file: { type: "string", minLength: 1 },
            method: { type: "string", enum: ["pairwise"] },
            show: { type: "array", items: { type: "string", minLength: 1 } },
            dimensions: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
        judge: {
          type: "object",
          additionalProperties: false,
          required: ["model", "rubric_file"],
          properties: {
            model: { type: "string" },
            provider_route: { type: "string" },
            rubric_file: { type: "string" },
            methods: {
              type: "array",
              items: { type: "string", enum: ["pairwise-swap", "absolute-1-5"] },
            },
            show: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      },
    },
    execution: {
      type: "object",
      additionalProperties: false,
      required: ["trials_per_case"],
      properties: {
        trials_per_case: { type: "integer", minimum: 1 },
        concurrency: { type: "integer", minimum: 1 },
        benchmark_mode: { type: "string", enum: ["capability-neutral", "production-realistic"] },
        cache_mode: { type: "string", enum: ["cold", "warm", "both"] },
        minimum_meaningful_difference: { type: ["number", "null"] },
      },
    },
    "x-harness": {
      type: "object",
      additionalProperties: false,
      required: ["producer"],
      properties: {
        producer: { type: "string", enum: ["prompt", "codegen"] },
        prompt_file: { type: "string" },
        default_temperature: { type: "number", minimum: 0, maximum: 2 },
        /** Set true only when the same-vendor judge is a deliberate, documented choice. */
        allow_same_vendor_judge: { type: "boolean" },
      },
    },
  },
} as const;
