/**
 * Verify every candidate and judge model in a spec is usable from HERE, and
 * print current list prices.
 *
 *   pnpm run check-models specs/codegen-w38.yaml [specs/prd-w38.yaml ...]
 *   pnpm run check-models --catalog-only specs/…      (no key, no probe)
 *
 * Two different questions, and the catalog only answers the first:
 *   1. does the model exist on OpenRouter?  — public catalog
 *   2. will it answer a call from this account and region?  — live probe
 * A model can be listed, priced, and still 403 "not available in your region"
 * on every trial. That happened: a whole run's candidate was region-blocked
 * while this script reported `ok`, so the probe is on by default.
 *
 * The probe sends one `max_tokens: 1` message per model. That is a real
 * (tiny) charge, and it is worth it: an unroutable candidate poisons every
 * comparison it appears in.
 *
 * Exit 1 when any model is missing or unreachable.
 */

import { loadWorkflow } from "../src/spec/load-spec.js";
import { loadEnvLocal } from "../src/run.js";
import type { Suite } from "../src/types.js";

interface CatalogModel {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

type ProbeState = "ok" | "blocked" | "unauthorized" | "error" | "skipped";

interface Probe {
  state: ProbeState;
  detail: string;
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

/** One smallest-possible completion. Never throws; the caller reports the state. */
async function probe(model: string, apiKey: string): Promise<Probe> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
    if (res.ok) return { state: "ok", detail: "" };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) return { state: "unauthorized", detail: message };
    if (res.status === 403) return { state: "blocked", detail: message };
    return { state: "error", detail: `HTTP ${res.status}: ${message}` };
  } catch (err: unknown) {
    return { state: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

const LABEL: Record<ProbeState, string> = {
  ok: "ok      ",
  blocked: "BLOCKED ",
  unauthorized: "NO KEY  ",
  error: "ERROR   ",
  skipped: "listed  ",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const catalogOnly = args.includes("--catalog-only");
  const specPaths = args.filter((a) => !a.startsWith("--"));
  if (specPaths.length === 0) {
    console.error("usage: check-models [--catalog-only] <spec.yaml> [...]");
    process.exit(2);
  }

  await loadEnvLocal();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!catalogOnly && !apiKey) {
    console.error("OPENROUTER_API_KEY is not set; run with --catalog-only to check the catalog alone.");
    process.exit(2);
  }

  const catalog = await fetchCatalog();
  let unusable = 0;
  for (const specPath of specPaths) {
    const models = modelsToCheck(await loadWorkflow(specPath));
    console.log(`\n${specPath}`);
    for (const [model, role] of models) {
      const m = catalog.get(model);
      if (!m) {
        unusable += 1;
        console.log(`  MISSING  ${model.padEnd(36)} ${role} — not in the OpenRouter catalog`);
        continue;
      }
      const json = m.supported_parameters?.includes("response_format") ? "json" : "no-json";
      const result = catalogOnly ? ({ state: "skipped", detail: "" } as Probe) : await probe(model, apiKey!);
      if (result.state !== "ok" && result.state !== "skipped") unusable += 1;
      console.log(
        `  ${LABEL[result.state]} ${model.padEnd(36)} ${role.padEnd(26)} in $${perMillion(m.pricing?.prompt)}/M out $${perMillion(m.pricing?.completion)}/M  ctx ${m.context_length ?? "?"}  ${json}`,
      );
      if (result.detail !== "") console.log(`           ^ ${result.detail}`);
      if (role === "judge" && json === "no-json") {
        console.log(`           ^ judge does not advertise response_format; JSON parsing relies on the fallback regex`);
      }
    }
  }
  if (catalogOnly) {
    console.log("\ncatalog only: listed ≠ reachable. Drop --catalog-only to probe from here.");
  }
  if (unusable > 0) {
    console.error(`\n${unusable} model(s) not usable from here`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
