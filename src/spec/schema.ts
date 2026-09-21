/**
 * JSON Schema for the protocol-style evaluation spec (YAML on disk).
 *
 * Kept as a plain object (not a .json import) so it type-checks with the loader
 * and can be reused by any other language via `printSchema()`. Only fields the
 * v0.4 protocol names plus one `x-harness` extension block for producer details
 * the protocol deliberately leaves to implementations.
 */

export const SPEC_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://57blocks.com/agentic-evaluator/spec-v0.4.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["protocol_version", "run_name", "workflow", "candidates", "evaluators", "execution"],
  properties: {
    protocol_version: { type: "string", enum: ["0.4"] },
    run_name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,63}$" },
    budget_usd: { type: "number", minimum: 0 },
    workflow: {
      type: "object",
      additionalProperties: false,
      required: ["steps"],
      properties: {
        control_candidate: { type: "string" },
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
              producer: { type: "string", enum: ["prompt", "codegen"] },
              prompt_file: { type: "string" },
              rubric_file: { type: "string" },
              input_from: { type: "string" },
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
            },
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

export function printSchema(): string {
  return JSON.stringify(SPEC_SCHEMA, null, 2);
}
