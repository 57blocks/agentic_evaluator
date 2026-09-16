/**
 * Bilingual (zh / en) UI strings for the eval report + dashboard renderers.
 *
 * The renderers (`render.ts`, `dashboard.ts`, `report.ts`) hold ZERO hard-coded
 * display text — every user-facing label routes through here so the two-language
 * dashboard toggle stays in sync from a single source. Data values (model names,
 * numbers, dates) are never translated; only chrome and rubric labels are.
 */

export type Lang = "zh" | "en";

export const LANGS: readonly Lang[] = ["zh", "en"];

/** A single label available in both languages. */
interface Bi {
  zh: string;
  en: string;
}

/** Friendly display labels for the known rubric dimension keys, per language. */
const DIM_LABELS: Record<string, Bi> = {
  completeness: { zh: "完整性", en: "Completeness" },
  testability: { zh: "可测试性", en: "Testability" },
  "no-hallucination": { zh: "无幻觉", en: "No hallucination" },
  structure: { zh: "结构", en: "Structure" },
  "prd-alignment": { zh: "PRD 对齐", en: "PRD alignment" },
  "data-api-clarity": { zh: "数据/接口清晰度", en: "Data/API clarity" },
  implementability: { zh: "可实现性", en: "Implementability" },
  granularity: { zh: "粒度", en: "Granularity" },
  dependencies: { zh: "依赖关系", en: "Dependencies" },
  verifiability: { zh: "可验证性", en: "Verifiability" },
  faithfulness: { zh: "忠实度", en: "Faithfulness" },
  actionability: { zh: "可执行性", en: "Actionability" },
  "meets-spec": { zh: "符合规格", en: "Meets spec" },
  correctness: { zh: "正确性", en: "Correctness" },
  "type-quality": { zh: "类型质量", en: "Type quality" },
  simplicity: { zh: "简洁性", en: "Simplicity" },
  robustness: { zh: "健壮性", en: "Robustness" },
};

/** A friendly column label for a dimension key (Title-Case fallback). */
export function dimLabel(key: string, lang: Lang): string {
  const known = DIM_LABELS[key];
  if (known) return known[lang];
  return key
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Static UI labels, keyed by a stable slug. */
const UI = {
  // page chrome
  dashTitle: { zh: "大模型评测 — 综合看板", en: "Model Evaluation — Dashboard" },
  eyebrow: { zh: "模型评测", en: "Model Evaluation" },
  lede: {
    zh: "按 pipeline 步骤对比候选模型:成对偏好排名 + 逐维度绝对分 + 客观门,并汇总成本与延迟。",
    en: "Compares candidate models per pipeline step: pairwise preference ranking + per-dimension absolute scores + objective gates, with cost and latency rolled up.",
  },
  noReports: { zh: "未找到任何步骤报告。", en: "No step reports found." },
  langToggle: { zh: "EN", en: "中文" },
  // meta line
  generatedAt: { zh: "生成于", en: "Generated" },
  judge: { zh: "裁判", en: "Judge" },
  candidates: { zh: "候选模型", en: "Candidates" },
  step: { zh: "步骤", en: "Step" },
  // champions / verdict
  championsHead: { zh: "各步骤冠军", en: "Per-step champions" },
  champion: { zh: "冠军", en: "Champion" },
  autoVerdictLabel: { zh: "结论速览 · 数据自动汇总", en: "At a glance · auto-summarised from data" },
  perStepChamps: { zh: "各步骤偏好冠军:", en: "Per-step preference champions: " },
  cheapest: { zh: "成本最低", en: "Cheapest" },
  bestTsc: { zh: "codegen tsc 最佳", en: "best codegen tsc" },
  aiVerdictLabel: { zh: "AI 讲评 · 模型生成", en: "AI verdict · model-written" },
  aiRecoHead: { zh: "选型建议", en: "Selection guidance" },
  aiGenerated: { zh: "AI 生成", en: "AI-generated" },
  scenario: { zh: "场景", en: "Scenario" },
  pick: { zh: "推荐", en: "Pick" },
  // ranking table
  overallRanking: { zh: "综合排名", en: "Overall ranking" },
  model: { zh: "模型", en: "Model" },
  record: { zh: "战绩", en: "Record" },
  wlt: { zh: "胜–负–平", en: "W–L–T" },
  absScore: { zh: "绝对分", en: "Abs. score" },
  objScore: { zh: "客观分", en: "Objective" },
  avgCost: { zh: "平均成本", en: "Avg cost" },
  avgLatency: { zh: "平均延迟", en: "Avg latency" },
  okRate: { zh: "成功率", en: "OK rate" },
  noRankedOutput: { zh: "无排名输出。", en: "No ranked output." },
  noDuels: { zh: "无对局", en: "no duels" },
  championReasonFallback: { zh: "综合成对对局中最受偏好。", en: "Most preferred across pairwise duels overall." },
  // objective labels
  objTsc: { zh: "tsc 通过", en: "tsc pass" },
  objCoverage: { zh: "覆盖率", en: "Coverage" },
  objGeneric: { zh: "客观分", en: "Objective" },
  // charts
  dimProfile: { zh: "维度剖面", en: "Dimension profile" },
  dimProfileSub: { zh: "— 1–5 绝对分 · 雷达(圆心 1,边缘 5)", en: "— 1–5 absolute · radar (centre 1, rim 5)" },
  dimScoreBars: { zh: "维度绝对分", en: "Dimension scores" },
  dimScoreBarsSub: { zh: "— 1–5", en: "— 1–5" },
  dimPref: { zh: "维度偏好", en: "Dimension preference" },
  dimPrefSub: { zh: "— 对局胜率,相对", en: "— win rate over duels, relative" },
  radarAria: { zh: "各模型逐维度绝对分雷达图", en: "Per-model per-dimension absolute-score radar" },
  barsAria: { zh: "各模型的逐维度绝对分(0–5)", en: "Per-model per-dimension absolute scores (0–5)" },
  // reasons
  input: { zh: "输入", en: "Input" },
  dimension: { zh: "维度", en: "Dimension" },
  winner: { zh: "胜者", en: "Winner" },
  reason: { zh: "理由", en: "Reason" },
  tie: { zh: "平局", en: "tie" },
  overallRow: { zh: "总体", en: "Overall" },
  reasonsDisclaimer: {
    zh: "这些是<b>单场、相对 A/B</b> 的裁判理由(单一输入、仅取首个成功输出),<b>不是该维度的综合质量评价</b>;维度层只列出<b>与总体判定不一致</b>的项(标 ⚠,即真正的取舍点),一致的已隐藏。绝对质量请看上方「绝对分 1–5」表。",
    en: "These are <b>single-duel, relative A/B</b> judge rationales (one input, first successful output only), <b>not per-dimension quality grades</b>; the dimension rows list only those that <b>diverge from the overall verdict</b> (marked ⚠ — the real trade-offs), agreeing ones are hidden. For absolute quality see the “Abs. score 1–5” table above.",
  },
  // objective detail
  objDetail: { zh: "客观详情", en: "Objective detail" },
  check: { zh: "检查", en: "Check" },
  result: { zh: "结果", en: "Result" },
  // footer
  totalSpendPre: { zh: "总花费:$", en: "Total spend: $" },
} as const;

export type UiKey = keyof typeof UI;

/** Look up a static UI label in the given language. */
export function t(lang: Lang, key: UiKey): string {
  return UI[key][lang];
}

// ── templated phrases (interpolation differs by language) ────────────────────

/** Champion header line: "preferred in W of N duels · record R (W–L–T)". */
export function champWinLine(
  lang: Lang,
  comparisons: number,
  wins: number,
  recordStr: string,
): string {
  if (lang === "en") {
    return `preferred in ${wins} of ${comparisons} duels · record ${recordStr} <span class="sub">(W–L–T)</span>`;
  }
  return `${comparisons} 场对局中胜出 ${wins} 场 · 战绩 ${recordStr} <span class="sub">(胜–负–平)</span>`;
}

/** Ranking-row duel suffix: "N duels · P%". */
export function duelSuffix(lang: Lang, comparisons: number, ratePct: string): string {
  if (lang === "en") return ` <span class="sub">${comparisons} duels · ${ratePct}%</span>`;
  return ` <span class="sub">共 ${comparisons} 场 · ${ratePct}%</span>`;
}

/** Champions-table duel count: "N duels" / "共 N 场". */
export function duelCount(lang: Lang, comparisons: number): string {
  if (lang === "en") return `<span class="sub">${comparisons} duels</span>`;
  return `<span class="sub">共 ${comparisons} 场</span>`;
}

/** Absolute-score suffix on the champion line: " · abs 4.8/5". */
export function absScoreSuffix(lang: Lang, scoreStr: string): string {
  if (lang === "en") return ` · abs ${scoreStr}<span class="sub">/5</span>`;
  return ` · 绝对分 ${scoreStr}<span class="sub">/5</span>`;
}

/** Reasons <summary>: overall + K divergences over N comparisons. */
export function reasonsSummary(lang: Lang, divergences: number, total: number): string {
  if (lang === "en") {
    return `Duel rationales · overall + ${divergences} dimension divergence(s) (${total} comparisons)`;
  }
  return `对决理由 · 总体 + ${divergences} 处维度分歧(共 ${total} 场对比)`;
}

/** Footer total spend: "…$X, over N runs". */
export function totalSpendLine(lang: Lang, total: string, runs: number): string {
  if (lang === "en") return `Total spend: $${total}, over ${runs} runs`;
  return `总花费:$${total},共 ${runs} 次运行`;
}

/** "how to read" caveat block (HTML), per language. */
export function caveatHtml(lang: Lang): string {
  if (lang === "en") {
    return `<div class="note"><b>How to read this — two lenses:</b> <b>Record (W–L–T)</b> is a <b>pairwise preference ranking</b> — each model's wins/losses/ties over a handful of head-to-head duels (single judge, order-debiased). It reliably shows <b>direction</b> but is coarse: with few duels, <b>0</b> means “lost every duel”, not “bad output”. <b>Absolute score (1–5)</b> grades each output on its own — read <b>that</b> to judge the <b>size</b> of a quality gap (a strong runner-up still hugs the champion, e.g. 4.2 vs 4.5, even at 0 wins). Neither is a percentage grade; raising <code>trials</code> and input count sharpens both.</div>`;
  }
  return `<div class="note"><b>怎么读这份报告 —— 两个透镜:</b> <b>战绩(胜–负–平)</b>是<b>成对偏好排名</b> —— 每个模型在若干场捉对中的胜负平(单一裁判、正反消偏)。它可靠地表达<b>方向</b>,但分辨率粗:对局少时,<b>0</b> 意味「每场都输」,而非「输出差」。<b>绝对分(1–5)</b>是对每份输出单独打的分 —— 看<b>它</b>才能判断质量差距的<b>大小</b>(强的亚军仍紧贴冠军,比如 4.2 对 4.5,即使 0 胜)。两者都不是百分制;提高 <code>trials</code> 和输入数量可让二者更精确。</div>`;
}

/** Markdown mirror of the caveat (report.ts markdown only; stays zh). */
export const CAVEAT_MD =
  "> **怎么读 —— 两个透镜:** **战绩(胜–负–平)** 是*成对偏好排名*" +
  "(若干场捉对的胜负平,单一裁判、正反消偏)——可靠地表达*方向*,但分辨率粗," +
  "所以 `0` 意味「每场都输」,而非「输出差」。" +
  "**绝对分(1–5)** 是对每份输出单独打的分——看它才能判断差距的*大小*" +
  "(强的亚军即使 0 胜也紧贴冠军)。";
