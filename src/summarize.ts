/**
 * AI 讲评 — feed the aggregated scorecards to an LLM and get back a written
 * verdict + a recommendation table (the same kind of content that was
 * hand-authored in the shareable artifact, but here generated from THIS run's
 * numbers so it adapts to whatever the data shows). One LLM call per dashboard;
 * opt-in from the CLI so a plain re-render stays free.
 *
 * Self-contained: reads only the report scorecards, calls `llm.ts` `complete`.
 */

import { complete } from "./llm.js";
import type { Report } from "./types.js";

export interface AiRecommendation {
  scenario: string;
  pick: string;
  reason: string;
}

export interface AiSummary {
  /** 2–4 sentence written verdict (Chinese). */
  verdict: string;
  /** Scenario → recommended model → reason. */
  recommendations: AiRecommendation[];
}

/** Compact, token-lean metrics digest the model reasons over. */
function digest(reports: Report[]): string {
  const short = (c: string): string => c.split("/").pop() ?? c;
  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`## ${r.step}`);
    for (const s of r.scorecards) {
      const dims = s.dimensionScores
        ? Object.entries(s.dimensionScores)
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => `${k}:${(v as number).toFixed(1)}`)
            .join(",")
        : "";
      const obj =
        s.objectivePassRate == null
          ? "n/a"
          : `${(s.objectivePassRate * 100).toFixed(0)}%`;
      lines.push(
        `- ${short(s.candidate)}: winRate=${s.winRate ?? "n/a"}, absScore=${s.absoluteScore ?? "n/a"}/5, obj=${obj}, cost=$${s.avgCostUsd.toFixed(4)}, latency=${(s.avgMs / 1000).toFixed(0)}s${dims ? `, dims[${dims}]` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function buildPrompt(reports: Report[]): string {
  return [
    "你是资深模型评测分析师。下面是一次评测的聚合指标:",
    "winRate=成对偏好胜率(0–100,方向可靠但样本小)、absScore=绝对分(1–5,看质量差距大小)、",
    "obj=客观通过率(codegen=tsc 编译;taskbreakdown=需求覆盖,自报)、cost/latency=平均成本与延迟、",
    "dims=各维度绝对分(越低越是短板)。",
    "",
    digest(reports),
    "",
    "请用**中文**输出:",
    "1) verdict:2–4 句总体结论——点明质量差距大小、性价比、关键短板;并务必提示样本很小(trials=1)只宜定方向。",
    "2) recommendations:3–5 条选型建议,每条含 scenario(场景)、pick(推荐模型)、reason(理由)。",
    "只依据以上数据,不要编造数字或模型。仅输出如下形状的 JSON:",
    `{"verdict":"…","recommendations":[{"scenario":"…","pick":"…","reason":"…"}]}`,
  ].join("\n");
}

function parse(text: string): AiSummary {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`summary returned no JSON: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("summary JSON is not an object");
  }
  const o = parsed as Record<string, unknown>;
  const verdict = typeof o.verdict === "string" ? o.verdict.trim() : "";
  const recommendations = Array.isArray(o.recommendations)
    ? o.recommendations
        .map((x) => {
          const r = (x ?? {}) as Record<string, unknown>;
          return {
            scenario: typeof r.scenario === "string" ? r.scenario : "",
            pick: typeof r.pick === "string" ? r.pick : "",
            reason: typeof r.reason === "string" ? r.reason : "",
          };
        })
        .filter((r) => r.scenario || r.pick)
    : [];
  if (!verdict && recommendations.length === 0) {
    throw new Error("summary JSON has neither verdict nor recommendations");
  }
  return { verdict, recommendations };
}

const MAX_ATTEMPTS = 3;

/** Generate a written verdict + recommendations from the run's scorecards. */
export async function generateAiSummary(params: {
  reports: Report[];
  model: string;
  timeoutMs?: number;
}): Promise<AiSummary> {
  const prompt = buildPrompt(params.reports);
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const { text } = await complete({
        model: params.model,
        prompt,
        temperature: attempt === 0 ? 0.2 : 0.5,
        timeoutMs: params.timeoutMs ?? 120_000,
        jsonMode: true,
        maxTokens: 2000,
      });
      return parse(text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
