/**
 * Verify every candidate and judge model in a spec is routable on OpenRouter,
 * and print current list prices. No API key needed (public catalog).
 *
 *   pnpm run check-models -- specs/codegen-w38.yaml [specs/prd-w38.yaml ...]
 *
 * Exit 1 when any model is missing — an unroutable candidate would otherwise
 * show up as provider_error on every trial and poison the comparison.
 */

import { loadWorkflow } from "../src/spec/load-spec.js";
import type { Suite } from "../src/types.js";

interface CatalogModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

async function fetchCatalog(): Promise<Map<string, CatalogModel>> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter catalog: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: CatalogModel[] };
  return new Map((json.data ?? []).map((m) => [m.id, m]));
}

const perMillion = (v: string | undefined): string => (v === undefined ? "  ?  " : (Number(v) * 1e6).toFixed(2).padStart(6));

/** OpenRouter ids actually used by any step. CLI-only candidates have no model. */
function modelsToCheck(suites: readonly Suite[]): Map<string, string> {
  const models = new Map<string, string>();
  for (const suite of suites) {
    for (const [id, def] of Object.entries(suite.candidateDefs ?? {})) {
      if (def.model) models.set(def.model, `candidate ${id}`);
    }
    models.set(suite.judge, "judge");
  }
  return models;
}

async function main(): Promise<void> {
  const specPaths = process.argv.slice(2);
  if (specPaths.length === 0) {
    console.error("usage: check-models <spec.yaml> [...]");
    process.exit(2);
  }
  const catalog = await fetchCatalog();
  let missing = 0;
  for (const specPath of specPaths) {
    const models = modelsToCheck(await loadWorkflow(specPath));
    console.log(`\n${specPath}`);
    for (const [model, role] of models) {
      const m = catalog.get(model);
      if (!m) {
        missing += 1;
        console.log(`  MISSING  ${model.padEnd(36)} ${role}`);
        continue;
      }
      const json = m.supported_parameters?.includes("response_format") ? "json" : "no-json";
      console.log(
        `  ok       ${model.padEnd(36)} ${role.padEnd(26)} in $${perMillion(m.pricing?.prompt)}/M out $${perMillion(m.pricing?.completion)}/M  ctx ${m.context_length ?? "?"}  ${json}`,
      );
      if (role === "judge" && json === "no-json") {
        console.log(`           ^ judge does not advertise response_format; JSON parsing relies on the fallback regex`);
      }
    }
  }
  if (missing > 0) {
    console.error(`\n${missing} model(s) not routable on OpenRouter`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
