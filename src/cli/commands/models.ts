/**
 * `agenteval models <task>` — is every model this task names usable from here?
 *
 * Two different questions, and the public catalog only answers the first:
 *   1. does the model exist on OpenRouter?          — the catalog
 *   2. will it answer a call from this account and region?  — a live probe
 *
 * A model can be listed, priced, and still 403 "not available in your region"
 * on every trial. That happened: a whole run's candidate was region-blocked
 * while this check reported `ok`, so the probe is on by default. It sends one
 * `max_tokens: 1` message per model — a real, tiny charge, and worth it,
 * because an unroutable candidate poisons every comparison it appears in.
 *
 * Moved here from `scripts/check-models.ts` unchanged in substance: same two
 * questions, same probe, same states.
 */

import { loadWorkflow } from "../../spec/load-spec.js";
import { findWorkspace, resolveSpecPath, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import type { Suite } from "../../types.js";

export const MODELS_HELP = `agenteval models <task> [options]

  Check every candidate and judge model the task names: is it in the
  OpenRouter catalog, will it answer from here, and what does it list at.

  --catalog-only      skip the live probe (no key needed, and nothing billed —
                      but listed is not the same as reachable)
  --json              print the findings as JSON
  --workspace DIR     workspace to resolve <task> under

  Exits 1 when any model is missing or unreachable.`;

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

interface Finding {
  model: string;
  role: string;
  state: ProbeState | "missing";
  detail: string;
  promptUsdPerM: number | null;
  completionUsdPerM: number | null;
  contextLength: number | null;
  supportsJsonMode: boolean;
}

async function fetchCatalog(): Promise<Map<string, CatalogModel>> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter catalog: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: CatalogModel[] };
  return new Map((json.data ?? []).map((m) => [m.id, m]));
}

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

const LABEL: Record<ProbeState | "missing", string> = {
  ok: "ok      ",
  blocked: "BLOCKED ",
  unauthorized: "NO KEY  ",
  error: "ERROR   ",
  skipped: "listed  ",
  missing: "MISSING ",
};

const perMillion = (v: string | undefined): number | null => (v === undefined ? null : Number(v) * 1e6);
const money = (v: number | null): string => (v === null ? "  ?  " : v.toFixed(2).padStart(6));

export async function cmdModels(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["catalog-only", "json", "workspace"]);
  const target = args.positional[0];
  if (target === undefined) throw new UsageError("which task? (try `agenteval ls`)");

  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const spec = await resolveSpecPath(ws, target);

  const catalogOnly = args.flags["catalog-only"] === true;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!catalogOnly && !apiKey) {
    throw new UsageError("OPENROUTER_API_KEY is not set; use --catalog-only to check the catalog alone");
  }

  const catalog = await fetchCatalog();
  const findings: Finding[] = [];
  for (const [model, role] of modelsToCheck(await loadWorkflow(spec))) {
    const m = catalog.get(model);
    if (!m) {
      findings.push({
        model,
        role,
        state: "missing",
        detail: "not in the OpenRouter catalog",
        promptUsdPerM: null,
        completionUsdPerM: null,
        contextLength: null,
        supportsJsonMode: false,
      });
      continue;
    }
    const result = catalogOnly ? ({ state: "skipped", detail: "" } as Probe) : await probe(model, apiKey!);
    findings.push({
      model,
      role,
      state: result.state,
      detail: result.detail,
      promptUsdPerM: perMillion(m.pricing?.prompt),
      completionUsdPerM: perMillion(m.pricing?.completion),
      contextLength: m.context_length ?? null,
      supportsJsonMode: m.supported_parameters?.includes("response_format") === true,
    });
  }

  const unusable = findings.filter((f) => f.state !== "ok" && f.state !== "skipped").length;

  if (args.flags.json) {
    io.out(`${JSON.stringify({ spec, catalogOnly, unusable, findings }, null, 2)}\n`);
    return unusable > 0 ? EXIT.failed : EXIT.ok;
  }

  io.out(`\n${spec}\n`);
  for (const f of findings) {
    const json = f.supportsJsonMode ? "json" : "no-json";
    io.out(
      `  ${LABEL[f.state]} ${f.model.padEnd(36)} ${f.role.padEnd(26)} in $${money(f.promptUsdPerM)}/M out $${money(f.completionUsdPerM)}/M  ctx ${f.contextLength ?? "?"}  ${json}\n`,
    );
    if (f.detail !== "") io.out(`           ^ ${f.detail}\n`);
    if (f.role === "judge" && !f.supportsJsonMode) {
      io.out("           ^ judge does not advertise response_format; JSON parsing relies on the fallback regex\n");
    }
  }
  if (catalogOnly) {
    io.out("\ncatalog only: listed ≠ reachable. Drop --catalog-only to probe from here.\n");
  }
  if (unusable > 0) {
    io.err(`\n${unusable} model(s) not usable from here\n`);
    return EXIT.failed;
  }
  return EXIT.ok;
}
