/**
 * The report's sentences, in Chinese, built from structured data.
 *
 * The selector writes its reasons in English into recommendation.json, and
 * those stay as they are — they are a protocol artifact, read by tools and
 * by audits. A reader, though, should not get an English clause spliced into
 * a Chinese sentence. So every sentence here is rebuilt from the numbers the
 * decision was made on (gates, thresholds, each candidate's rates), and only
 * a reason this file does not recognise falls through verbatim.
 *
 * No Node imports: the dashboard's browser bundle reads this file too.
 */

import type { Recommendation } from "./canon/select.js";
import type { Rate } from "./canon/rates.js";
import type { EligibilityThresholds } from "./canon/types.js";

// ── labels ──────────────────────────────────────────────────────────────────

const MODE_LABEL: Record<string, string> = {
  "lowest-cost": "成本最低",
  "fastest-within-cost-ceiling": "成本上限内最快",
  "highest-assurance": "最稳妥",
  "judge-preference": "裁判偏好",
};

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return "未声明运行模式";
  return MODE_LABEL[mode] ?? mode;
}

const MODE_EXPLAIN: Record<string, string> = {
  "lowest-cost": "在通过全部门槛的候选里，选每次成功生成成本最低的。",
  "fastest-within-cost-ceiling": "在成本上限以内，选中位耗时最短的。",
  "highest-assurance": "选任务成功率最高的；并列时看必过检查通过率，再看成本。",
  "judge-preference": "没有确定性检查可用，按裁判偏好排序；结论最多只能「仅供参考」。",
};

/** What an operating mode does, in one sentence. */
export function modeExplain(mode: string | null | undefined): string {
  if (!mode) return "没有声明运行模式，合格候选之间不会做选择。";
  return MODE_EXPLAIN[mode] ?? `运行模式 ${mode}。`;
}

export const FIRMNESS_LABEL: Record<Recommendation["firmness"], string> = {
  firm: "结论可靠",
  directional: "仅供参考",
  "needs-review": "需要人工判断",
};

const COMPLETION_LABEL: Record<string, string> = {
  success: "正常完成",
  refusal: "拒答",
  timeout: "超时",
  malformed: "输出格式错误",
  cancelled: "已取消",
  provider_error: "服务商出错",
  skipped: "跳过",
};

const OUTCOME_LABEL: Record<string, string> = {
  success: "成功",
  failure: "失败",
  undetermined: "未判定",
};

const EVALUATION_LABEL: Record<string, string> = {
  pass: "通过",
  fail: "未通过",
  not_evaluated: "未评估",
  evaluator_error: "评估器出错",
};

export const completionLabel = (s: string): string => COMPLETION_LABEL[s] ?? s;
export const outcomeLabel = (s: string): string => OUTCOME_LABEL[s] ?? s;
export const evaluationLabel = (s: string): string => EVALUATION_LABEL[s] ?? s;

// ── numbers in words ─────────────────────────────────────────────────────────

const pct = (v: number): string => `${(v * 100).toFixed(v === 1 || v === 0 ? 0 : 1)}%`;

/** `88.9%（8/9）`, or `无法计算（0/0）` when nothing was counted. */
export function rateText(r: Rate): string {
  return r.value === null ? `无法计算（${r.numerator}/${r.denominator}）` : `${pct(r.value)}（${r.numerator}/${r.denominator}）`;
}

const usd = (v: number): string => `$${v.toFixed(4)}`;

// ── the gates ────────────────────────────────────────────────────────────────

export interface GateRow {
  label: string;
  removed: Array<{ candidate: string; detail: string }>;
  remaining: string[];
}

function gateLabel(id: string, e: EligibilityThresholds, fallback: string): string {
  switch (id) {
    case "qualifying-success-criteria":
      return "规格声明了必过检查";
    case "required-check-pass-rate":
      return e.minimum_required_check_pass_rate === null ? fallback : `必过检查通过率 ≥ ${pct(e.minimum_required_check_pass_rate)}`;
    case "reliability":
      return e.minimum_reliability === null ? fallback : `任务成功率 ≥ ${pct(e.minimum_reliability)}`;
    case "p95-ceiling":
      return e.maximum_p95_ms === null ? fallback : `p95 耗时 ≤ ${e.maximum_p95_ms} ms`;
    case "cost-ceiling":
      return e.cost_ceiling_per_success_usd === null ? fallback : `每次成功成本 ≤ $${e.cost_ceiling_per_success_usd}`;
    default:
      return fallback;
  }
}

/**
 * The gates a step will apply, in the order the selector applies them —
 * the same order and the same words the report's 筛选过程 uses afterwards.
 */
export function gateLabels(e: EligibilityThresholds, requiredChecks: readonly string[], mode: string | null | undefined): string[] {
  const ids: string[] = [];
  if (requiredChecks.length === 0 && mode !== "judge-preference") ids.push("qualifying-success-criteria");
  if (e.minimum_required_check_pass_rate !== null) ids.push("required-check-pass-rate");
  if (e.minimum_reliability !== null) ids.push("reliability");
  if (e.maximum_p95_ms !== null) ids.push("p95-ceiling");
  if (mode === "fastest-within-cost-ceiling" && e.cost_ceiling_per_success_usd !== null) ids.push("cost-ceiling");
  return ids.map((id) => gateLabel(id, e, id));
}

function removedDetail(gate: string, candidate: string, rec: Recommendation, fallback: string): string {
  const t = rec.tradeoffs.find((x) => x.candidate === candidate);
  if (!t) return fallback;
  switch (gate) {
    case "qualifying-success-criteria":
      return "规格没有声明必过检查";
    case "required-check-pass-rate":
      return `必过检查通过 ${rateText(t.required_check_pass_rate)}`;
    case "reliability":
      return `任务成功 ${rateText(t.reliability)}`;
    case "p95-ceiling":
      return t.p95_ms === null ? "测不到 p95 耗时" : `p95 ${t.p95_ms} ms`;
    case "cost-ceiling":
      return t.generation_cost_per_success === null ? "没有成功的任务，成本无法计算" : usd(t.generation_cost_per_success);
    default:
      return fallback;
  }
}

/** Each eligibility gate in order: what it asked, who it removed and why, who was left. */
export function gateRows(rec: Recommendation): GateRow[] {
  return rec.filters.map((f) => ({
    label: gateLabel(f.id, rec.eligibility, f.description),
    removed: f.removed.map((r) => ({ candidate: r.candidate, detail: removedDetail(f.id, r.candidate, rec, r.reason) })),
    remaining: f.remaining,
  }));
}

// ── the recommendation ───────────────────────────────────────────────────────

function pickClause(rec: Recommendation): string {
  const chosen = rec.chosen as string;
  const t = rec.tradeoffs.find((x) => x.candidate === chosen);
  const n = rec.eligible.length;
  const among = n > 1 ? `在通过全部门槛的 ${n} 个候选里，` : "它是唯一通过全部门槛的候选，";
  switch (rec.operating_mode) {
    case "lowest-cost":
      return t?.generation_cost_per_success != null
        ? `${among}${chosen} 每次成功的生成成本最低（${usd(t.generation_cost_per_success)}）。`
        : `${among}按成本最低选出 ${chosen}。`;
    case "fastest-within-cost-ceiling":
      return t?.p50_ms != null
        ? `${among}${chosen} 的中位耗时最短（${(t.p50_ms / 1000).toFixed(1)} s）。`
        : `${among}按成本上限内最快选出 ${chosen}。`;
    case "highest-assurance":
      return t ? `${among}${chosen} 的任务成功率最高（${rateText(t.reliability)}）。` : `${among}按最稳妥选出 ${chosen}。`;
    case "judge-preference":
      return `这一步没有确定性检查可以判断对错，推荐只反映裁判模型的偏好：${chosen} 最受偏好。`;
    default:
      return `推荐 ${chosen}。`;
  }
}

/** When a cheaper or faster candidate lost to the control on the declared minimum difference. */
function keptControlClause(rec: Recommendation): string {
  const first = rec.reasons[0] ?? "";
  const m = first.match(/^(?:cheapest|fastest) eligible is (\S+)/);
  if (!m || !rec.control_candidate) return "";
  return `${m[1]} 虽然更${first.startsWith("cheapest") ? "便宜" : "快"}，但差距没有达到规格声明的最小有意义差异，所以保留对照 ${rec.control_candidate}。`;
}

function controlClause(rec: Recommendation): string {
  const control = rec.control_candidate;
  if (!control || !rec.chosen) return "";
  if (rec.chosen === control) return keptControlClause(rec) || "它同时也是对照候选。";
  const beats = rec.compared_to_control?.beats_control;
  if (beats === true) return `比对照 ${control} 更好。`;
  if (beats === false) return `和对照 ${control} 相比没有优势。`;
  return "";
}

/** One paragraph: what is recommended and why, or why nothing is. */
export function recommendationSentence(rec: Recommendation): string {
  if (rec.chosen) return pickClause(rec) + controlClause(rec);
  if (!rec.operating_mode) return "规格没有声明运行模式，所以无法在合格候选之间做选择。";
  if (rec.eligible.length === 0) return "没有候选通过全部门槛，所以这一步不给推荐。";
  return `有 ${rec.eligible.length} 个候选合格，但按「${modeLabel(rec.operating_mode)}」分不出高下。`;
}

// ── how firm, and what the judge thought ─────────────────────────────────────

function directionalReason(reason: string): string {
  const inputs = reason.match(/^(\d+) inputs?; fewer than (\d+)/) ?? reason.match(/^fewer than (\d+) inputs/);
  if (inputs && inputs.length === 3) return `只有 ${inputs[1]} 个输入（少于 ${inputs[2]} 个）`;
  if (inputs) return `输入少于 ${inputs[1]} 个`;
  if (/no minimum meaningful difference/.test(reason)) return "规格没有声明最小有意义差异";
  if (/^judge-preference/.test(reason)) return "排序完全依赖裁判模型";
  return reason;
}

/** Why the recommendation is as firm as it is, in words a reader can act on. */
export function firmnessNote(firmness: Recommendation["firmness"], directionalReasons: readonly string[]): string {
  if (firmness === "firm") return "样本量和阈值都满足决策要求。";
  if (firmness === "needs-review") return "这一步没有可采纳的推荐，需要有人看过下面的证据再决定。";
  const why = directionalReasons.map(directionalReason);
  return why.length > 0 ? `${why.join("，")}，所以这个结论只能作为方向参考。` : "这个结论只能作为方向参考。";
}

export interface JudgePick {
  candidate: string;
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
  sole: boolean;
  disagrees: boolean;
}

/** The judge's favourite, always kept apart from the recommendation. */
export function judgeNote(j: JudgePick | null, chosen: string | null): string {
  if (!j) return "这次没有可用的成对比较。";
  if (!j.sole) return "裁判没有分出高下：胜率最高的候选不止一个。";
  const record = `${j.wins} 胜 ${j.losses} 负 ${j.ties} 平，共 ${j.comparisons} 场`;
  const head = `裁判最偏好 ${j.candidate}（${record}）`;
  if (j.disagrees) return `${head}，和推荐不一致——推荐只在通过必过检查的候选之间按运行模式比较，不参考裁判偏好。`;
  if (chosen === j.candidate) return `${head}，和推荐一致。`;
  return `${head}。`;
}
