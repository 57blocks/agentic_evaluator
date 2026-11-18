// Held-out UI tests for demo-todo, against the running build (WEB_URL, with
// the real backend at API_URL). One test per unit-level acceptance test of the
// adopted test plan, re-expressed through the page: elements are found only by
// the data-testid anchors UI_CONTRACT.md fixes, routes are the PRD's, and data is
// made through the contract's endpoints, so any build honouring the contracts can pass.
import { test, expect } from "@playwright/test";

const API = process.env.API_URL;
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const tid = (id) => `[data-testid="${id}"]`;

async function api(request, method, path, data) {
  const res = await request.fetch(new URL(path, API).toString(), { method, data });
  expect(res.status(), `${method} ${path}`).toBeLessThan(300);
  return res.json();
}
const newMember = (r) => api(r, "POST", "/api/members", { name: `成员-${uid()}` });
const newTask = (r, extra = {}) => api(r, "POST", "/api/tasks", { title: `任务-${uid()}`, ...extra });
const go = (r, id, to) => api(r, "POST", `/api/tasks/${id}/transitions`, { to });
const card = (page, id) => page.locator(`${tid("task-card")}[data-task-id="${id}"]`);
const workload = async (page, memberId) => {
  const text = await page.locator(`${tid("workload-item")}[data-member-id="${memberId}"]`).innerText();
  const nums = text.match(/\d+/g);
  return Number(nums ? nums[nums.length - 1] : NaN);
};

test("AT-001 an empty title disables create and shows 标题必填 on blur", async ({ page }) => {
  await page.goto("/tasks/new");
  await expect(page.locator(tid("new-task-submit-button"))).toBeDisabled();
  await page.locator(tid("new-task-title-input")).focus();
  await page.locator(tid("new-task-title-input")).blur();
  await expect(page.locator(tid("new-task-title-error"))).toContainText("标题必填");
});

test("AT-003/AT-024 creating a task returns to the board, where the todo column shows it", async ({ page }) => {
  const title = `新任务-${uid()}`;
  await page.goto("/tasks/new");
  await page.locator(tid("new-task-title-input")).fill(title);
  await page.locator(tid("new-task-submit-button")).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(tid("todo-column"))).toContainText(title);
});

test("AT-004 the todo column grows by one card per new task", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(tid("todo-column"))).toBeVisible();
  const before = await page.locator(`${tid("todo-column")} ${tid("task-card")}`).count();
  const t = await newTask(request);
  await page.reload();
  await expect(card(page, t.id)).toBeVisible();
  await expect(page.locator(`${tid("todo-column")} ${tid("task-card")}`)).toHaveCount(before + 1);
});

test("AT-005 a failed create keeps the form and shows the error", async ({ page }) => {
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "服务器开小差了", message: "服务器开小差了" }) })
      : route.continue());
  const title = `会失败-${uid()}`;
  await page.goto("/tasks/new");
  await page.locator(tid("new-task-title-input")).fill(title);
  await page.locator(tid("new-task-description-textarea")).fill("描述保留");
  await page.locator(tid("new-task-submit-button")).click();
  await expect(page.locator(tid("new-task-error"))).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.locator(tid("new-task-title-input"))).toHaveValue(title);
  await expect(page.locator(tid("new-task-description-textarea"))).toHaveValue("描述保留");
});

test("AT-006 the assignee options are the roster plus 未分配", async ({ page, request }) => {
  await newMember(request);
  const { members } = await api(request, "GET", "/api/members");
  await page.goto("/tasks/new");
  const options = page.locator(`${tid("new-task-assignee-select")} option`);
  await expect(options).toHaveCount(members.length + 1);
  await expect(page.locator(tid("new-task-assignee-select"))).toContainText("未分配");
  for (const m of members) await expect(page.locator(tid("new-task-assignee-select"))).toContainText(m.name);
});

test("AT-008 choosing an assignee saves at once", async ({ page, request }) => {
  const m = await newMember(request);
  const t = await newTask(request);
  await page.goto(`/tasks/${t.id}`);
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes(`/api/tasks/${t.id}`));
  await page.locator(tid("task-detail-assignee-select")).selectOption(m.id);
  await patched;
  await expect.poll(async () => (await api(request, "GET", `/api/tasks/${t.id}`)).assigneeId).toBe(m.id);
});

test("AT-009/AT-025 reassigning moves one unit of workload, seen back on the board", async ({ page, request }) => {
  const a = await newMember(request);
  const b = await newMember(request);
  const t = await newTask(request, { assigneeId: a.id });
  await page.goto("/");
  const aBefore = await workload(page, a.id);
  const bBefore = await workload(page, b.id);
  await page.goto(`/tasks/${t.id}`);
  await page.locator(tid("task-detail-assignee-select")).selectOption(b.id);
  await expect.poll(async () => (await api(request, "GET", `/api/tasks/${t.id}`)).assigneeId).toBe(b.id);
  await page.locator(tid("task-detail-back-link")).click();
  await expect.poll(() => workload(page, a.id)).toBe(aBefore - 1);
  await expect.poll(() => workload(page, b.id)).toBe(bBefore + 1);
});

test("AT-010 a todo task offers one transition, a done task none", async ({ page, request }) => {
  const todo = await newTask(request);
  await page.goto(`/tasks/${todo.id}`);
  await expect(page.locator(tid("task-detail-status-badge"))).toBeVisible();
  await expect(page.locator(tid("task-detail-transition-button"))).toHaveCount(1);
  const done = await newTask(request);
  await go(request, done.id, "in_progress");
  await go(request, done.id, "done");
  await page.goto(`/tasks/${done.id}`);
  await expect(page.locator(tid("task-detail-status-badge"))).toBeVisible();
  await expect(page.locator(tid("task-detail-transition-button"))).toHaveCount(0);
});

test("AT-012 marking a card done moves it from in progress to done", async ({ page, request }) => {
  const t = await newTask(request);
  await go(request, t.id, "in_progress");
  await page.goto("/");
  await expect(page.locator(`${tid("in-progress-column")} ${tid("task-card")}[data-task-id="${t.id}"]`)).toBeVisible();
  await page.locator(`${tid("task-card-advance-button")}[data-task-id="${t.id}"]`).click();
  await expect(page.locator(`${tid("in-progress-column")} ${tid("task-card")}[data-task-id="${t.id}"]`)).toHaveCount(0);
  await page.locator(tid("show-completed-toggle")).click();
  await expect(page.locator(`${tid("done-column")} ${tid("task-card")}[data-task-id="${t.id}"]`)).toBeVisible();
});

test("AT-013 the first load shows no done card", async ({ page, request }) => {
  const t = await newTask(request);
  await go(request, t.id, "in_progress");
  await go(request, t.id, "done");
  await page.goto("/");
  await expect(page.locator(tid("todo-column"))).toBeVisible();
  await expect(page.locator(tid("done-column"))).toHaveCount(0);
  await expect(card(page, t.id)).toHaveCount(0);
});

test("AT-014 no tasks: the empty state, without empty columns", async ({ page }) => {
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks: [] }) })
      : route.continue());
  await page.goto("/");
  await expect(page.locator(tid("board-empty"))).toBeVisible();
  await expect(page.locator(tid("todo-column"))).toHaveCount(0);
});

test("AT-015 a member's workload counts their todo and in-progress tasks", async ({ page, request }) => {
  const m = await newMember(request);
  await newTask(request, { assigneeId: m.id });
  const doing = await newTask(request, { assigneeId: m.id });
  await go(request, doing.id, "in_progress");
  const done = await newTask(request, { assigneeId: m.id });
  await go(request, done.id, "in_progress");
  await go(request, done.id, "done");
  await page.goto("/");
  await expect.poll(() => workload(page, m.id)).toBe(2);
});

test("AT-016 filtering by assignee shows only that member's cards", async ({ page, request }) => {
  const m = await newMember(request);
  const mine = await newTask(request, { assigneeId: m.id });
  await newTask(request);
  await page.goto("/");
  await page.locator(tid("assignee-filter-select")).selectOption(m.id);
  await expect(card(page, mine.id)).toBeVisible();
  const { tasks } = await api(request, "GET", "/api/tasks");
  const theirs = new Set(tasks.filter((t) => t.assigneeId === m.id).map((t) => t.id));
  const shown = await page.locator(tid("task-card")).evaluateAll((els) => els.map((e) => e.getAttribute("data-task-id")));
  expect(shown.length).toBeGreaterThan(0);
  for (const id of shown) expect(theirs.has(id), `card ${id} is not ${m.id}'s`).toBe(true);
});

test("AT-018 adding a duplicate name shows 该成员已存在", async ({ page }) => {
  const name = `重名-${uid()}`;
  await page.goto("/members");
  await page.locator(tid("new-member-name-input")).fill(name);
  await page.locator(tid("add-member-button")).click();
  await expect(page.locator(tid("member-row")).filter({ hasText: name })).toHaveCount(1);
  await page.locator(tid("new-member-name-input")).fill(name);
  await page.locator(tid("add-member-button")).click();
  await expect(page.locator(tid("new-member-name-error"))).toContainText("该成员已存在");
});

test("AT-020 a confirmed removal takes the member's row away", async ({ page, request }) => {
  const m = await newMember(request);
  await page.goto("/members");
  const row = page.locator(`${tid("member-row")}[data-member-id="${m.id}"]`);
  await expect(row).toBeVisible();
  await page.locator(`${tid("member-remove-button")}[data-member-id="${m.id}"]`).click();
  await page.locator(tid("member-remove-confirm-button")).click();
  await expect(row).toHaveCount(0);
});

test("AT-021 an unassigned task's card says 未分配", async ({ page, request }) => {
  const t = await newTask(request, { assigneeId: null });
  await page.goto("/");
  await expect(card(page, t.id)).toContainText("未分配");
});
