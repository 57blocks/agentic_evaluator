/**
 * The per-input comparison on the run page (canon/input-compare.ts): a row
 * per input, a column per candidate, the required check's passes k/n and the
 * measures in each cell. Each row is a <details>: it opens to that input's
 * trials — the check's state and reason, its evidence, and the opening of
 * the deliverable. No script; a grid keeps ~30 inputs × 3 candidates on one
 * screen when closed.
 */

import { escapeHtml } from "./html.js";
import { fmtMeasure } from "./canon/measures.js";
import type { CompareCell, CompareRow } from "./canon/input-compare.js";
import type { RawOutput } from "./report-evidence.js";
import type { InputGroup } from "./canon/headline.js";

/** Characters of the deliverable shown under a trial; the whole text is under Candidate outputs. */
const EXCERPT_CHARS = 600;

const STATE_CHIP: Record<string, string> = { pass: "win", fail: "bad" };

type OutputsByKey = ReadonlyMap<string, RawOutput>;
const keyOf = (candidate: string, input: string, trial: number): string => `${candidate}\0${input}\0${trial}`;

function passPill(c: CompareCell): string {
  const ungraded = c.trials.length - c.graded;
  const more = ungraded > 0 ? `<span class="sub">+${ungraded} not graded</span>` : "";
  if (c.trials.length === 0) return `<span class="muted">not run</span>`;
  if (c.graded === 0) return `<span class="pill warn">—</span>${more}`;
  const tone = c.pass === c.graded ? "pass" : c.pass === 0 ? "miss" : "warn";
  return `<span class="pill ${tone}">${c.pass}/${c.graded}</span>${more}`;
}

/** What a cell says under its passes: for one candidate on one input, plain text parts. */
export type CellNote = (candidate: string, input: string) => string[];

/** Every measure's mean on this input, or only what `note` gives when the check has headlines of its own. */
function measuresLine(c: CompareCell, input: string, note: CellNote | undefined): string {
  const parts = note ? note(c.candidate, input).map(escapeHtml) : Object.entries(c.measures).map(([name, v]) => `${escapeHtml(name)} ${fmtMeasure(v)}`);
  return parts.length === 0 ? "" : `<span class="sub">${parts.join(" · ")}</span>`;
}

function trialBlock(input: string, c: CompareCell, outputs: OutputsByKey): string {
  if (c.trials.length === 0) return `<div class="cmp-cell muted">no trial</div>`;
  const items = c.trials
    .map((t) => {
      const state = t.checks[0]?.state ?? t.completion;
      const chip = `<span class="chip ${STATE_CHIP[state] ?? "warn"}">t${t.trial} ${escapeHtml(state)}</span>`;
      const reason = t.checks.map((ch) => ch.reason).filter((r): r is string => !!r && r !== state).join("; ");
      const ended = t.completion === "success" ? "" : ` <span class="muted">(${escapeHtml(t.completion)})</span>`;
      const evidence = t.checks.map((ch) => ch.evidence).filter((e): e is string => !!e).join("; ");
      const out = outputs.get(keyOf(c.candidate, input, t.trial));
      const excerpt =
        out && out.text
          ? `<details class="excerpt"><summary>the deliverable${out.totalChars > EXCERPT_CHARS ? `, first ${EXCERPT_CHARS} of ${out.totalChars.toLocaleString()} characters` : ""}</summary><pre class="raw">${escapeHtml(out.text.slice(0, EXCERPT_CHARS))}</pre></details>`
          : "";
      return `<div class="cmp-trial">${chip}${ended}${reason ? ` ${escapeHtml(reason)}` : ""}${evidence ? `<div class="muted ev">${escapeHtml(evidence)}</div>` : ""}${excerpt}</div>`;
    })
    .join("");
  return `<div class="cmp-cell">${items}</div>`;
}

function rowHtml(r: CompareRow, outputs: OutputsByKey, note: CellNote | undefined): string {
  const cells = r.cells.map((c) => `<span class="cmp-cell">${passPill(c)}${measuresLine(c, r.input, note)}</span>`).join("");
  return `<details class="cmp-row${r.differs ? " differs" : ""}"><summary class="cmp-grid"><span class="mono cmp-input">${escapeHtml(r.input)}</span>${cells}</summary>
    <div class="cmp-grid cmp-trials"><span></span>${r.cells.map((c) => trialBlock(r.input, c, outputs)).join("")}</div></details>`;
}

/**
 * `groups`: the check's input groups (canon/headline.ts). With them, each
 * group is its own table under what a pass means there — a pass is not the
 * same thing on a defect item and on a clean one — and the rest come last.
 */
export function renderInputComparison(rows: readonly CompareRow[], candidates: readonly string[], outputs: readonly RawOutput[], note?: CellNote, groups: readonly InputGroup[] = []): string {
  // No required check ran anywhere (a judge-only step): there is nothing per input to compare.
  const checked = rows.some((r) => r.cells.some((c) => c.trials.some((t) => t.checks.length > 0)));
  if (!checked) return "";
  const byKey: OutputsByKey = new Map(outputs.map((o) => [keyOf(o.candidate, o.input, o.trial), o]));
  const differing = rows.filter((r) => r.differs).length;
  const table = (own: readonly CompareRow[]): string => `<div class="cmp" style="--cols:${candidates.length}">
      <div class="cmp-grid cmp-head"><span>Input</span>${candidates.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>
      ${own.map((r) => rowHtml(r, byKey, note)).join("")}
    </div>`;
  const grouped = new Set(groups.flatMap((g) => [...g.inputs]));
  const rest = rows.filter((r) => !grouped.has(r.input));
  const tables =
    groups.length === 0
      ? table(rows)
      : [
          ...groups.map((g) => `<h3>${escapeHtml(g.title)} <span class="hint">a pass: ${escapeHtml(g.pass)}</span></h3>\n    ${table(rows.filter((r) => g.inputs.has(r.input)))}`),
          ...(rest.length > 0 ? [`<h3>Other inputs</h3>\n    ${table(rest)}`] : []),
        ].join("\n    ");
  return `<section class="card">
    <h2>Per input <span class="hint">required-check passes / graded trials, and ${note ? "the check's headline numbers on this input" : "the check's measures averaged over the input's graded trials"} · inputs where the candidates differ first · open a row for its trials</span></h2>
    <p class="note">${differing} of ${rows.length} inputs separate the candidates on the required check.</p>
    ${tables}
  </section>`;
}

export const COMPARE_STYLES = `
.cmp{overflow-x:auto;font-size:13px}
.cmp-grid{display:grid;grid-template-columns:minmax(10em,1.2fr) repeat(var(--cols),minmax(11em,1fr));gap:4px 12px;align-items:start;min-width:calc(10em + var(--cols) * 11em)}
.cmp-head{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);padding:6px 8px;border-bottom:1px solid var(--rule);background:var(--surface-2)}
.cmp-row{border-bottom:1px solid var(--rule)}.cmp-row>summary{cursor:pointer;padding:6px 8px;list-style:none}.cmp-row>summary::-webkit-details-marker{display:none}
.cmp-row>summary:hover{background:var(--surface-2)}.cmp-row.differs>summary{box-shadow:inset 3px 0 0 var(--accent)}.cmp-row[open]>summary{background:var(--surface-2)}
.cmp-input{overflow-wrap:anywhere}.cmp-cell .sub{display:block;font-size:11px;color:var(--ink-3)}
.cmp-trials{padding:4px 8px 10px}.cmp-trial{margin:0 0 8px;font-size:12px;overflow-wrap:anywhere}.cmp-trial .ev{font-size:11.5px;margin-top:2px}
.cmp .chip.bad{background:var(--bad-bg);color:var(--bad-fg);border-color:transparent}
.cmp-trial details.excerpt summary{font-size:11px;color:var(--ink-3);cursor:pointer}.cmp-trial pre.raw{max-height:240px;white-space:pre-wrap;font-size:11.5px}
`;
