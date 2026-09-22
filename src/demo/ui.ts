/** Self-contained demo page. Served by demo/server.ts. */

export function demoPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>这一步该用谁 · Agentic Evaluator</title>
<style>
:root{
  --ground:#F1EFE8;--paper:#FBF9F4;--ink:#1C1915;--muted:#5C564C;--line:#D9D1C3;
  --accent:#1F4E46;--accent-2:#C45C26;--ok:#1E6B3A;--bad:#9B2C25;--warn:#7D5410;
  --ok-bg:#DDF1E4;--bad-bg:#F8DEDC;--warn-bg:#F8ECD2;--chip:#E7E1D4;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
  --sans:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Source Han Sans SC",ui-sans-serif,system-ui,sans-serif;
}
@media(prefers-color-scheme:dark){
  :root{--ground:#161411;--paper:#1E1B16;--ink:#F3EEE4;--muted:#B7AFA2;--line:#3A342C;
    --accent:#8FBFB4;--accent-2:#E08A58;--ok:#8FD6A8;--bad:#F0A29C;--warn:#EACB7C;
    --ok-bg:#1F3A2A;--bad-bg:#43231F;--warn-bg:#3F3319;--chip:#2A261F}
}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--ground);color:var(--ink);font:15px/1.5 var(--sans)}
a{color:var(--accent)}button{font:inherit;cursor:pointer}
.skip{position:absolute;left:-999px;top:8px;background:var(--paper);padding:8px 12px}
.skip:focus{left:8px;z-index:9}
.app{display:grid;grid-template-columns:280px 1fr;min-height:100%}
@media(max-width:840px){.app{grid-template-columns:1fr}}
aside{background:var(--paper);border-right:1px solid var(--line);padding:22px 18px 40px;display:flex;flex-direction:column;gap:22px}
@media(max-width:840px){aside{border-right:0;border-bottom:1px solid var(--line)}}
.brand{display:grid;gap:4px}.brand p{margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}
.brand h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.02em}
.brand .sub{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
nav h2{margin:16px 0 8px;font-size:12px;color:var(--muted);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.list button{width:100%;text-align:left;border:1px solid transparent;background:transparent;border-radius:8px;padding:8px 10px;color:var(--ink)}
.list button:hover,.list button:focus-visible{background:var(--chip);outline:none}
.list button[aria-current="true"]{border-color:var(--line);background:var(--chip)}
.list .k{display:block;font-family:var(--mono);font-size:12px}
.list .m{display:block;font-size:12px;color:var(--muted)}
main{padding:28px 28px 64px;min-width:0}
.questions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:22px}
@media(max-width:1100px){.questions{grid-template-columns:1fr 1fr}}
@media(max-width:640px){.questions{grid-template-columns:1fr}}
.q{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.q b{display:block;font-size:12px;color:var(--accent);margin-bottom:4px}
.q span{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.stage{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:22px;display:grid;gap:18px}
.stage h2{margin:0;font-size:20px}.meta{color:var(--muted);font-size:13px}
.pipeline{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}
.step{flex:1 1 220px;border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:grid;gap:8px;background:var(--ground)}
.step h3{margin:0;font-size:16px;display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.step h3 em{font-style:normal;font-size:11px;font-family:var(--mono);color:var(--muted);font-weight:500}
.pill{display:inline-block;font-size:11px;font-weight:650;padding:2px 8px;border-radius:999px;letter-spacing:.04em}
.pill.ok{background:var(--ok-bg);color:var(--ok)}
.pill.bad{background:var(--bad-bg);color:var(--bad)}
.pill.warn{background:var(--warn-bg);color:var(--warn)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:var(--mono);font-size:11px;background:var(--chip);padding:2px 7px;border-radius:4px}
.chip.off{opacity:.55;text-decoration:line-through}
.trace{margin:0;padding-left:1.15em;color:var(--muted);font-size:13px;display:grid;gap:6px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:8px 12px;color:var(--ink);text-decoration:none;display:inline-block}
.btn.primary{background:var(--accent);color:#FBF9F4;border-color:var(--accent)}
@media(prefers-color-scheme:dark){.btn.primary{color:#161411}}
.empty{color:var(--muted)}
.list .runs{list-style:none;margin:2px 0 6px;padding:0 0 0 10px;display:grid;gap:2px;border-left:1px solid var(--line)}
.list .runs button{padding:5px 8px}
.list .runs .m{font-size:11px}
.spend.over{color:var(--bad);font-weight:650}
.files{display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:12px;align-items:start}
.files .names{list-style:none;margin:0;padding:0;display:grid;gap:2px;max-height:60vh;overflow:auto}
.files .names button{width:100%;text-align:left;border:1px solid transparent;background:transparent;border-radius:6px;padding:5px 8px;color:var(--ink);font-family:var(--mono);font-size:12px}
.files .names button:hover,.files .names button:focus-visible{background:var(--chip);outline:none}
.files .names button[aria-current="true"]{border-color:var(--line);background:var(--chip)}
.files pre{margin:0;padding:12px;background:var(--paper);border:1px solid var(--line);border-radius:10px;max-height:60vh;overflow:auto;font-family:var(--mono);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.runtable{width:100%;border-collapse:collapse;font-size:13px}
.runtable th{text-align:left;font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line)}
.runtable td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.runtable tbody tr:hover{background:var(--chip)}
.runtable .num{font-family:var(--mono);white-space:nowrap}
.runtable button{border:0;background:transparent;padding:0;color:var(--accent);text-decoration:underline;font-size:13px}
.task-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.task-head .n{font-family:var(--mono);font-size:12px}
.task-head .c{font-size:11px;color:var(--muted);white-space:nowrap}
iframe{width:100%;min-height:70vh;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
.note{font-size:12px;color:var(--muted);margin:0}
</style>
</head>
<body>
<a class="skip" href="#stage">跳到内容</a>
<div class="app">
  <aside>
    <div class="brand">
      <p>Agent Evaluation Protocol v0.4</p>
      <h1>这一步该用谁</h1>
      <p class="sub">不是模型排行榜。推荐绑定步骤、测试集、运行模式。本地只读，不会开跑。</p>
    </div>
    <nav aria-label="任务">
      <h2>任务</h2>
      <ul class="list" id="tasks"></ul>
    </nav>
    <nav aria-label="冒烟任务" id="smokeNav" hidden>
      <h2>冒烟（脚本候选）</h2>
      <ul class="list" id="smokeTasks"></ul>
      <p class="note">候选是本地脚本，不是模型。用来验证管线，不是证据。</p>
    </nav>
    <nav aria-label="仓库样例" id="unfiledNav" hidden>
      <h2>仓库样例</h2>
      <ul class="list" id="unfiled"></ul>
      <p class="note">committed 的示例证据，不属于任何任务。</p>
    </nav>
  </aside>
  <main>
    <section class="questions" aria-label="协议要回答的四个问题">
      <div class="q"><b>1. 做对了吗</b><span>任务结果 × 必过检查，不用平均分冒充成功</span></div>
      <div class="q"><b>2. 这一步用谁</b><span>每步自己的推荐，资格门先于选型</span></div>
      <div class="q"><b>3. 成本还是速度</b><span>只在合格候选里按 operating mode 选</span></div>
      <div class="q"><b>4. 证据能否复现</b><span>打开本步 report.html</span></div>
    </section>
    <section class="stage" id="stage" tabindex="-1"><p class="empty">选左侧一份规格或一次运行。</p></section>
  </main>
</div>
<script>
const tasksEl = document.getElementById("tasks");
const smokeEl = document.getElementById("smokeTasks");
const smokeNav = document.getElementById("smokeNav");
const unfiledEl = document.getElementById("unfiled");
const unfiledNav = document.getElementById("unfiledNav");
const stage = document.getElementById("stage");
let catalog = { tasks: [], unfiled: [], specs: [], runs: [] };

/** Every run the catalog knows, task-owned or not — hash lookups stay flat. */
function allRuns() {
  return catalog.tasks.flatMap((t) => t.runs).concat(catalog.unfiled);
}
function allSpecs() {
  return catalog.tasks.map((t) => ({
    path: t.specPath, runName: t.runName, budgetUsd: t.budgetUsd, steps: t.steps,
  }));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function firmClass(f) {
  if (f === "firm") return "ok";
  if (f === "needs-review") return "bad";
  return "warn";
}
function firmPill(f) {
  return '<span class="pill ' + firmClass(f) + '">' + escapeHtml(f) + "</span>";
}
function chips(items, off) {
  const blocked = new Set(off || []);
  const spans = items.map(function (x) {
    const cls = blocked.has(x) ? "chip off" : "chip";
    return '<span class="' + cls + '">' + escapeHtml(x) + "</span>";
  }).join("");
  return '<div class="chips">' + spans + "</div>";
}
function runDate(iso) {
  return iso ? escapeHtml(iso.slice(0, 10)) : "";
}
function runMoney(usd) {
  return usd == null ? "" : "$" + usd.toFixed(4);
}
/** One line under a run's name: when it ran, what it cost, and what it concluded. */
function runMeta(run) {
  const verdict = run.steps
    .map((s) => (s.chosen ? escapeHtml(s.chosen) : "需人工评审"))
    .join(" · ");
  return [runDate(run.startedAt), runMoney(run.totalUsd), verdict].filter(Boolean).join(" · ");
}
function navButton(kind, key, title, meta) {
  return '<li><button type="button" data-kind="' + kind + '" data-key="' + escapeHtml(key) +
    '"><span class="k">' + escapeHtml(title) + '</span><span class="m">' + meta + "</span></button></li>";
}

/** Task detail: what the task asks, how it is judged, and every run it produced. */
function renderTask(task) {
  const chain = task.steps.filter((s) => s.inputFrom);
  const handoffNote = chain.length
    ? "独立评测无交接；e2e 对照沿 " + task.steps.map((s) => s.id).join(" → ")
    : task.steps.length + " 个独立步骤（无交接）";
  const steps = task.steps.map((s) => \`
    <article class="step">
      <h3>\${escapeHtml(s.id)} <em>\${escapeHtml(s.producer)}</em></h3>
      <p class="meta">\${escapeHtml(s.operatingMode || "无运行模式")} · 检查 \${s.requiredChecks.length ? s.requiredChecks.join(", ") : "无"}\${s.inputFrom ? " · 交接自 " + escapeHtml(s.inputFrom) : ""}</p>
      \${chips(s.candidates)}
      <p class="note">输入 \${s.inputs.join("、")} · 裁判标准 \${escapeHtml(s.rubricFile)}</p>
    </article>\`).join("");

  const fileList = task.files.map((f) =>
    '<li><button type="button" data-file="' + escapeHtml(f) + '">' + escapeHtml(f) + "</button></li>"
  ).join("");

  const rows = task.runs.map((r) => {
    const verdict = r.steps
      .map((x) => (x.chosen ? escapeHtml(x.chosen) : '<span class="pill warn">需评审</span>'))
      .join(" / ");
    return "<tr>" +
      '<td class="num"><button type="button" data-kind="run" data-key="' + escapeHtml(r.id) + '">' +
        escapeHtml((r.startedAt || r.id).slice(0, 16).replace("T", " ")) + "</button></td>" +
      '<td class="num">' + (r.totalUsd == null ? "—" : "$" + r.totalUsd.toFixed(4)) + "</td>" +
      "<td>" + verdict + "</td>" +
      '<td class="num">' + escapeHtml(r.kind === "workflow" ? "多步骤" : "单步骤") +
        (r.synthetic ? " · 脚本" : "") + "</td>" +
      "</tr>";
  }).join("");

  const runsBlock = task.runs.length
    ? '<table class="runtable"><thead><tr><th>运行</th><th>成本</th><th>各步推荐</th><th>类型</th></tr></thead><tbody>' +
      rows + "</tbody></table>"
    : '<p class="empty">这个任务还没跑过。</p>';

  const spend = task.spentUsd == null
    ? ""
    : " · 已花 $" + task.spentUsd.toFixed(2) +
      (task.budgetUsd != null ? " / 预算 $" + task.budgetUsd + (task.spentUsd > task.budgetUsd ? "（超支）" : "") : "");

  stage.innerHTML = \`
    <div>
      <h2>\${escapeHtml(task.name)}</h2>
      <p class="meta">\${escapeHtml(task.specPath)}\${spend} · \${handoffNote}</p>
      <p class="note">预览不花钱：<code>pnpm run run -- --suite \${escapeHtml(task.specPath)} --html</code>。真跑再加 <code>--yes</code>。</p>
    </div>
    <div class="pipeline">\${steps}</div>
    <div>
      <h3>定义（\${task.files.length} 个文件）</h3>
      <div class="files">
        <ul class="names">\${fileList}</ul>
        <pre id="fileBody">选左侧一个文件。</pre>
      </div>
    </div>
    <div>
      <h3>运行（\${task.runs.length} 次）</h3>
      \${runsBlock}
    </div>\`;

  const body = document.getElementById("fileBody");
  const preferred = task.files.find((f) => f === "spec.yaml") || task.files[0];
  if (preferred) showFile(task.name, preferred, body);
}

/** Load one definition file into the pane, marking which name is current. */
async function showFile(taskName, rel, body) {
  for (const b of document.querySelectorAll(".files .names button")) {
    b.removeAttribute("aria-current");
    if (b.dataset.file === rel) b.setAttribute("aria-current", "true");
  }
  body.textContent = "载入中…";
  try {
    const res = await fetch("/artifact/task/" + encodeURIComponent(taskName) + "/" +
      rel.split("/").map(encodeURIComponent).join("/"));
    body.textContent = res.ok ? await res.text() : "读不到（" + res.status + "）";
  } catch (err) {
    body.textContent = "读不到：" + err.message;
  }
}

function renderRun(run) {
  const steps = run.steps.map((s) => {
    const gated = s.gated || [];
    const off = gated.map((g) => g.candidate);
    const why = gated.map((g) => "<li>" + escapeHtml(g.candidate) + " — " + escapeHtml(g.reason) + "</li>").join("");
    const rec = s.chosen ? "推荐 <b>" + escapeHtml(s.chosen) + "</b>" : "无人合格";
    const report = s.reportHref
      ? '<a class="btn" href="' + s.reportHref + '" target="report">打开本步报告</a>'
      : "";
    return \`
      <article class="step">
        <h3>\${escapeHtml(s.id)} \${firmPill(s.firmness)}</h3>
        <p>\${rec}</p>
        \${chips(s.eligible.concat(off), off)}
        \${why ? '<ol class="trace">' + why + "</ol>" : ""}
        <p class="note">\${escapeHtml(s.operatingMode || "")}\${s.ledgerTotal != null ? " · $" + s.ledgerTotal.toFixed(4) : ""}</p>
        <div class="actions">\${report}</div>
      </article>\`;
  }).join("");
  const firstReport = run.steps.find((s) => s.reportHref)?.reportHref;
  const kindLabel = run.kind === "workflow" ? "多步骤" : "单步骤";
  const handoffLabel = run.handoff ? " · 有交接" : " · 无交接";
  const sampleLabel = run.sample ? " · 仓库样例" : "";
  const e2e = run.e2e
    ? '<p class="note">单模型端到端对照 <b>' + escapeHtml(run.e2e.candidate) + "</b> · " +
      escapeHtml((run.e2e.chain || []).join(" → ")) +
      " · 成功 " + run.e2e.success + " / 失败 " + run.e2e.failure + " / 未定 " + run.e2e.undetermined + "</p>"
    : "";
  stage.innerHTML = \`
    <div>
      <h2>\${escapeHtml(run.runName)}</h2>
      <p class="meta">\${escapeHtml(run.id)} · \${kindLabel}\${handoffLabel}\${sampleLabel}</p>
      \${e2e}
    </div>
    <div class="pipeline">\${steps}</div>
    \${firstReport ? '<iframe title="步骤报告" src="' + firstReport + '"></iframe>' : ""}\`;
}

function markCurrent(kind, key) {
  for (const btn of document.querySelectorAll(".list button")) {
    btn.removeAttribute("aria-current");
    if (btn.dataset.kind === kind && btn.dataset.key === key) btn.setAttribute("aria-current", "true");
  }
}

/** Budget line: what the task has spent against what its spec allows. */
function spendLabel(task) {
  if (task.spentUsd == null) return "";
  const spent = "$" + task.spentUsd.toFixed(2);
  if (task.budgetUsd == null) return '<span class="spend">' + spent + "</span>";
  const over = task.spentUsd > task.budgetUsd;
  return '<span class="spend' + (over ? " over" : "") + '">' + spent + " / $" + task.budgetUsd +
    (over ? " 超支" : "") + "</span>";
}

/** What the task's most recent run concluded — the column you scan down. */
function latestLabel(task) {
  const r = task.runs[0];
  if (!r) return "未跑过";
  return runDate(r.startedAt) + " · " +
    r.steps.map((s) => (s.chosen ? escapeHtml(s.chosen) : "需人工评审")).join(" / ");
}

function taskItem(task) {
  const runs = task.runs.map((r) =>
    '<li><button type="button" data-kind="run" data-key="' + escapeHtml(r.id) + '">' +
      '<span class="m">' + runMeta(r) + "</span></button></li>"
  ).join("");
  return '<li>' +
    '<button type="button" data-kind="spec" data-key="' + escapeHtml(task.specPath) + '">' +
      '<span class="task-head"><span class="n">' + escapeHtml(task.name) + "</span>" +
      '<span class="c">' + task.runs.length + " 次 " + spendLabel(task) + "</span></span>" +
      '<span class="m">' + latestLabel(task) + "</span>" +
    "</button>" +
    (runs ? '<ul class="runs">' + runs + "</ul>" : "") +
    "</li>";
}

/** A task whose every run used scripted stand-ins proves the pipeline, not a model. */
function isSmokeTask(task) {
  return task.runs.length > 0 && task.runs.every((r) => r.synthetic);
}

function renderNav() {
  const smoke = catalog.tasks.filter(isSmokeTask);
  const real = catalog.tasks.filter((t) => !isSmokeTask(t));
  tasksEl.innerHTML = real.map(taskItem).join("") || '<li class="m">tasks/ 下还没有任务</li>';
  smokeEl.innerHTML = smoke.map(taskItem).join("");
  smokeNav.hidden = smoke.length === 0;
  unfiledEl.innerHTML = catalog.unfiled.map((r) =>
    navButton("run", r.id, r.runName, (r.sample ? "样例 · " : "") + runMeta(r))
  ).join("");
  unfiledNav.hidden = catalog.unfiled.length === 0;
}

function showFromHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const specPath = h.get("spec");
  const runId = h.get("run");
  const task = specPath && catalog.tasks.find((x) => x.specPath === specPath);
  if (task) {
    markCurrent("spec", specPath);
    renderTask(task);
    return;
  }
  const run = runId && allRuns().find((x) => x.id === runId);
  if (run) {
    markCurrent("run", runId);
    renderRun(run);
    return;
  }
  const first = allRuns()[0];
  if (first) {
    location.hash = "run=" + encodeURIComponent(first.id);
    return;
  }
  const task0 = catalog.tasks[0];
  if (task0) {
    location.hash = "spec=" + encodeURIComponent(task0.specPath);
  }
}

document.body.addEventListener("click", function (e) {
  const fileBtn = e.target.closest("button[data-file]");
  if (fileBtn) {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const task = catalog.tasks.find((t) => t.specPath === h.get("spec"));
    if (task) showFile(task.name, fileBtn.dataset.file, document.getElementById("fileBody"));
    return;
  }
  const btn = e.target.closest("button[data-kind]");
  if (!btn) return;
  location.hash = btn.dataset.kind + "=" + encodeURIComponent(btn.dataset.key);
});
window.addEventListener("hashchange", showFromHash);

async function loadCatalog() {
  try {
    const data = await (await fetch("/api/catalog")).json();
    catalog = data;
    renderNav();
    showFromHash();
  } catch (err) {
    stage.innerHTML = '<p class="empty">加载失败：' + escapeHtml(err.message) + "</p>";
  }
}
loadCatalog();
</script>
</body></html>`;
}
