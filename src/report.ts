/**
 * Render a single suite's Report as a markdown doc and an optional
 * self-contained HTML page. The HTML reuses the shared per-step card
 * (`render.ts`) so it matches the combined dashboard exactly; the markdown is a
 * text mirror of the same sections. No external deps, no template engine.
 */

import type { Report, Scorecard } from "./types.js";
import {
  CAVEAT_MD,
  SHARED_STYLE,
  caveatHtml,
  champion,
  dimLabel,
  dimensionKeys,
  escapeHtml,
  fmtPassRate,
  fmtRecord,
  fmtScore,
  hasAbsolute,
  hasObjective,
  objectiveLabel,
  overallRecord,
  ranked,
  renderStepCard,
} from "./render.js";

/** A dimension win rate as a plain string for markdown cells. */
function mdDimRate(s: Scorecard, dim: string): string {
  const map = s.dimensionWinRates ?? {};
  const v = map[dim];
  return typeof v === "number" ? v.toFixed(0) : "—";
}

/** Overall ranking table as markdown. Columns are built dynamically so the
 *  optional Score (absolute) and objective columns don't multiply the header
 *  string literals. */
function markdownRanking(report: Report): string {
  const showObj = hasObjective(report);
  const showScore = hasAbsolute(report);
  const heads = ["#", "Model", "Record (W–L–T)", "Duels"];
  const aligns = ["---", "-------", ":--------------:", "------:"];
  if (showScore) {
    heads.push("Score (1–5)");
    aligns.push("----------:");
  }
  if (showObj) {
    heads.push(objectiveLabel(report.step, "en"));
    aligns.push("---------:");
  }
  heads.push("Avg cost", "Avg latency", "OK rate");
  aligns.push("---------:", "------------:", "--------:");
  const rows = ranked(report.scorecards)
    .map((s, i) => {
      const rec = overallRecord(report, s.candidate);
      const cells = [`${i + 1}`, s.candidate, fmtRecord(rec), `${rec.comparisons}`];
      if (showScore) cells.push(fmtScore(s.absoluteScore));
      if (showObj) cells.push(fmtPassRate(s));
      cells.push(
        `$${s.avgCostUsd.toFixed(4)}`,
        `${(s.avgMs / 1000).toFixed(1)}s`,
        `${(s.okRate * 100).toFixed(0)}%`,
      );
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
  return [`| ${heads.join(" | ")} |`, `|${aligns.join("|")}|`, rows].join("\n");
}

/** Absolute dimension-score matrix (1–5) as markdown, or "" when not scored. */
function markdownScoreMatrix(report: Report): string {
  if (!hasAbsolute(report)) return "";
  const dims = dimensionKeys(report);
  if (dims.length === 0) return "";
  const header = `| Model | ${dims.map((d) => dimLabel(d, "en")).join(" | ")} |`;
  const divider = `|-------|${dims.map(() => "------:").join("|")}|`;
  const rows = ranked(report.scorecards)
    .map((s) => {
      const map = s.dimensionScores ?? {};
      const cells = dims.map((d) => {
        const v = map[d];
        return typeof v === "number" ? v.toFixed(1) : "—";
      });
      return `| ${s.candidate} | ${cells.join(" | ")} |`;
    })
    .join("\n");
  return ["### Dimension scores (1–5, absolute)", "", header, divider, rows].join("\n");
}

/** Dimension win-rate matrix as markdown, or "" when no dimensions. */
function markdownMatrix(report: Report): string {
  const dims = dimensionKeys(report);
  if (dims.length === 0) return "";
  const header = `| Model | ${dims.map((d) => dimLabel(d, "en")).join(" | ")} |`;
  const divider = `|-------|${dims.map(() => "------:").join("|")}|`;
  const rows = ranked(report.scorecards)
    .map((s) => `| ${s.candidate} | ${dims.map((d) => mdDimRate(s, d)).join(" | ")} |`)
    .join("\n");
  return ["### Dimension preference (win rate over duels, relative)", "", header, divider, rows].join("\n");
}

/** A few overall reasons, trimmed, for the markdown tail. */
function markdownReasons(report: Report): string {
  const lines = report.judgements
    .slice(0, 8)
    .map((j) => {
      const w =
        j.overall.resolved === "a"
          ? j.a
          : j.overall.resolved === "b"
            ? j.b
            : "tie";
      const reason = (j.overall.reason ?? "").replace(/\|/g, "\\|").slice(0, 160);
      return `- **${j.inputSlug} · ${j.a} vs ${j.b}** → ${w}: ${reason}`;
    })
    .join("\n");
  return lines ? ["### Overall reasoning (sample)", "", lines].join("\n") : "";
}

export function renderMarkdown(report: Report): string {
  const champ = champion(report);
  let champLine = "🏆 **Champion:** — (no ranked output)";
  if (champ && champ.winRate !== null) {
    const rec = overallRecord(report, champ.candidate);
    const score =
      champ.absoluteScore != null ? ` · score ${fmtScore(champ.absoluteScore)}/5` : "";
    champLine = `🏆 **Champion:** ${champ.candidate} — preferred in ${rec.wins} of ${rec.comparisons} duels (record ${fmtRecord(rec)} W–L–T)${score}`;
  }

  const sections = [
    `# Model Eval — ${report.suiteId}`,
    "",
    `- **Step:** ${report.step}`,
    `- **Judge:** ${report.judge}`,
    `- **Inputs:** ${report.inputs.join(", ")}`,
    `- **Generated:** ${report.generatedAt}`,
    "",
    champLine,
    "",
    CAVEAT_MD,
    "",
    "### Overall ranking",
    "",
    markdownRanking(report),
    "",
  ];

  const scoreMatrix = markdownScoreMatrix(report);
  if (scoreMatrix) sections.push(scoreMatrix, "");

  const matrix = markdownMatrix(report);
  if (matrix) sections.push(matrix, "");

  const reasons = markdownReasons(report);
  if (reasons) sections.push(reasons, "");

  return sections.join("\n");
}

export function renderHtml(report: Report): string {
  const meta = `步骤:${escapeHtml(report.step)} · 裁判:${escapeHtml(report.judge)} · ${escapeHtml(report.generatedAt)}`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>评测 — ${escapeHtml(report.suiteId)}</title>
${SHARED_STYLE}</head>
<body>
  <h1>大模型评测 — ${escapeHtml(report.suiteId)}</h1>
  <div class="meta">${meta}</div>
  ${caveatHtml("zh")}
  ${renderStepCard(report, "zh")}
</body></html>`;
}
