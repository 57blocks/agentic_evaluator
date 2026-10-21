/**
 * "How sure is this?" — the statistics firmness was decided on, and how much
 * of the input set carried evidence at all. Pure rendering.
 */

import type { ItemStats } from "./canon/item-stats.js";
import type { Recommendation } from "./canon/select.js";
import { clearsGate, fmtP } from "./canon/stats.js";
import { escapeHtml } from "./html.js";

const MAX_LISTED = 12;

function gateRows(rec: Recommendation): string {
  const gates = rec.evidence?.gates ?? [];
  if (gates.length === 0) return "";
  const rows = gates
    .map((g) => {
      const holds = clearsGate(g.low, g.threshold);
      return `<tr><td>${escapeHtml(g.gate)}</td><td class="num">${g.successes}/${g.n}</td><td class="num">${g.low.toFixed(3)}–${g.high.toFixed(3)}</td><td class="num">${g.threshold}</td><td class="${holds ? "ok" : "bad"}">${holds ? "holds" : "not shown"}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table>
      <thead><tr><th>Gate (${escapeHtml(rec.chosen ?? "")})</th><th class="num">Passed / inputs</th><th class="num">95% interval</th><th class="num">Gate</th><th>At the low end</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function versusLine(rec: Recommendation): string {
  const v = rec.evidence?.versus_runner_up;
  if (!v) return "";
  return `<p class="note">Against the runner-up, input by input: ${escapeHtml(v.a)} did better on ${v.a_better}, ${escapeHtml(v.b)} on ${v.b_better}, equal on ${v.same} (exact sign test p ${fmtP(v.p_value)}${v.significant ? "" : ", not significant"}).</p>`;
}

function itemsLine(items: ItemStats): string {
  if (items.inputs === 0) return "";
  const allFail = items.items.filter((i) => i.class === "all-fail").map((i) => i.input);
  const failNote =
    allFail.length === 0
      ? ""
      : ` Every candidate failed ${allFail.length}: ${allFail.slice(0, MAX_LISTED).map(escapeHtml).join(", ")}${allFail.length > MAX_LISTED ? " …" : ""} — check those for a harness or check bug first.`;
  return `<p class="note"><b>Effective N ${items.effective_n} of ${items.inputs}.</b> Inputs that separated any two candidates; ${items.counts["all-pass"]} every candidate passed and ${items.counts.flat} gave everyone the same partial rate, so they cannot inform a choice.${failNote} Per-input detail: items.json.</p>`;
}

export function renderCertainty(rec: Recommendation, items: ItemStats): string {
  const body = [gateRows(rec), versusLine(rec), itemsLine(items)].filter((s) => s !== "").join("\n    ");
  if (body === "") return "";
  return `<section class="card">
    <h2>How sure <span class="hint">Wilson 95% intervals counted per input; exact sign test over inputs</span></h2>
    ${body}
  </section>`;
}
