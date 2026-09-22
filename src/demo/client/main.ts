/**
 * Demo UI client: fetches the catalog, renders it, and wires the DOM.
 *
 * Typed against the catalog view models the server actually sends, so a shape
 * change there fails the build instead of rendering "undefined" in a browser.
 * Everything that is pure string-building lives in render.ts.
 */

import type { RunView, TaskView } from "../catalog.js";
import {
  chips,
  escapeHtml,
  firmPill,
  isSmokeTask,
  latestLabel,
  navButton,
  runMeta,
  spendLabel,
  taskItem,
} from "./render.js";

interface Catalog {
  tasks: TaskView[];
  unfiled: RunView[];
}

/** Elements the page skeleton guarantees; a missing one means a broken build. */
function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`demo page is missing #${id}`);
  return el;
}

const tasksEl = need("tasks");
const smokeEl = need("smokeTasks");
const smokeNav = need("smokeNav");
const unfiledEl = need("unfiled");
const unfiledNav = need("unfiledNav");
const stage = need("stage");
let catalog: Catalog = { tasks: [], unfiled: [] };

/** Every run the catalog knows, task-owned or not — hash lookups stay flat. */
function allRuns(): RunView[] {
  return catalog.tasks.flatMap((t) => t.runs).concat(catalog.unfiled);
}
function allSpecs() {
  return catalog.tasks.map((t) => ({
    path: t.specPath, runName: t.runName, budgetUsd: t.budgetUsd, steps: t.steps,
  }));
}

function renderTask(task: TaskView): void {
  const chain = task.steps.filter((s) => s.inputFrom);
  const handoffNote = chain.length
    ? "独立评测无交接；e2e 对照沿 " + task.steps.map((s) => s.id).join(" → ")
    : task.steps.length + " 个独立步骤（无交接）";
  const steps = task.steps.map((s) => `
    <article class="step">
      <h3>${escapeHtml(s.id)} <em>${escapeHtml(s.producer)}</em></h3>
      <p class="meta">${escapeHtml(s.operatingMode || "无运行模式")} · 检查 ${s.requiredChecks.length ? s.requiredChecks.join(", ") : "无"}${s.inputFrom ? " · 交接自 " + escapeHtml(s.inputFrom) : ""}</p>
      ${chips(s.candidates)}
      <p class="note">输入 ${s.inputs.join("、")} · 裁判标准 ${escapeHtml(s.rubricFile)}</p>
    </article>`).join("");

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

  stage.innerHTML = `
    <div>
      <h2>${escapeHtml(task.name)}</h2>
      <p class="meta">${escapeHtml(task.specPath)}${spend} · ${handoffNote}</p>
      <p class="note">预览不花钱：<code>pnpm run run -- --suite ${escapeHtml(task.specPath)} --html</code>。真跑再加 <code>--yes</code>。</p>
    </div>
    <div class="pipeline">${steps}</div>
    <div>
      <h3>定义（${task.files.length} 个文件）</h3>
      <div class="files">
        <ul class="names">${fileList}</ul>
        <pre id="fileBody">选左侧一个文件。</pre>
      </div>
    </div>
    <div>
      <h3>运行（${task.runs.length} 次）</h3>
      ${runsBlock}
    </div>`;

  const preferred = task.files.find((f) => f === "spec.yaml") ?? task.files[0];
  if (preferred) showFile(task.name, preferred, need("fileBody"));
}

/** Load one definition file into the pane, marking which name is current. */
async function showFile(taskName: string, rel: string, body: HTMLElement): Promise<void> {
  for (const b of document.querySelectorAll<HTMLElement>(".files .names button")) {
    b.removeAttribute("aria-current");
    if (b.dataset.file === rel) b.setAttribute("aria-current", "true");
  }
  body.textContent = "载入中…";
  try {
    const res = await fetch("/artifact/task/" + encodeURIComponent(taskName) + "/" +
      rel.split("/").map(encodeURIComponent).join("/"));
    body.textContent = res.ok ? await res.text() : "读不到（" + res.status + "）";
  } catch (err) {
    body.textContent = "读不到：" + (err instanceof Error ? err.message : String(err));
  }
}

function renderRun(run: RunView): void {
  const steps = run.steps.map((s) => {
    const gated = s.gated || [];
    const off = gated.map((g) => g.candidate);
    const why = gated.map((g) => "<li>" + escapeHtml(g.candidate) + " — " + escapeHtml(g.reason) + "</li>").join("");
    const rec = s.chosen ? "推荐 <b>" + escapeHtml(s.chosen) + "</b>" : "无人合格";
    const report = s.reportHref
      ? '<a class="btn" href="' + s.reportHref + '" target="report">打开本步报告</a>'
      : "";
    return `
      <article class="step">
        <h3>${escapeHtml(s.id)} ${firmPill(s.firmness)}</h3>
        <p>${rec}</p>
        ${chips(s.eligible.concat(off), off)}
        ${why ? '<ol class="trace">' + why + "</ol>" : ""}
        <p class="note">${escapeHtml(s.operatingMode || "")}${s.ledgerTotal != null ? " · $" + s.ledgerTotal.toFixed(4) : ""}</p>
        <div class="actions">${report}</div>
      </article>`;
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
  stage.innerHTML = `
    <div>
      <h2>${escapeHtml(run.runName)}</h2>
      <p class="meta">${escapeHtml(run.id)} · ${kindLabel}${handoffLabel}${sampleLabel}</p>
      ${e2e}
    </div>
    <div class="pipeline">${steps}</div>
    ${firstReport ? '<iframe title="步骤报告" src="' + firstReport + '"></iframe>' : ""}`;
}

function markCurrent(kind: string, key: string): void {
  for (const btn of document.querySelectorAll<HTMLElement>(".list button")) {
    btn.removeAttribute("aria-current");
    if (btn.dataset.kind === kind && btn.dataset.key === key) btn.setAttribute("aria-current", "true");
  }
}

function renderNav(): void {
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

function showFromHash(): void {
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
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;

  const fileBtn = target.closest<HTMLElement>("button[data-file]");
  if (fileBtn?.dataset.file) {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const task = catalog.tasks.find((t) => t.specPath === h.get("spec"));
    if (task) showFile(task.name, fileBtn.dataset.file, need("fileBody"));
    return;
  }

  const btn = target.closest<HTMLElement>("button[data-kind]");
  if (!btn?.dataset.kind || !btn.dataset.key) return;
  location.hash = btn.dataset.kind + "=" + encodeURIComponent(btn.dataset.key);
});
window.addEventListener("hashchange", showFromHash);

async function loadCatalog(): Promise<void> {
  try {
    const data = await (await fetch("/api/catalog")).json();
    catalog = data;
    renderNav();
    showFromHash();
  } catch (err) {
    stage.innerHTML = '<p class="empty">加载失败：' + escapeHtml(err instanceof Error ? err.message : err) + "</p>";
  }
}
loadCatalog();
