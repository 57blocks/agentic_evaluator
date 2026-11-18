// Held-out API tests for demo-todo, black box over HTTP (API_URL).
// One test per integration-level acceptance test of the adopted test plan
// (AT-002, 007, 011, 017, 019, 022, 023), written against _contracts/api-routes.json
// only: no import of the build's code, so any build that honours the contract can pass.
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_URL;
if (!BASE) throw new Error("API_URL is not set");
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function api(method, path, body) {
  const res = await fetch(new URL(path, BASE), {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, body: json };
}
const ok = (r, what) => assert.ok(r.status >= 200 && r.status < 300, `${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
const newTask = async (extra = {}) => { const r = await api("POST", "/api/tasks", { title: `heldout-${uid()}`, ...extra }); ok(r, "create task"); return r.body; };
const newMember = async () => { const r = await api("POST", "/api/members", { name: `成员-${uid()}` }); ok(r, "create member"); return r.body; };
const go = (id, to) => api("POST", `/api/tasks/${id}/transitions`, { to });

test("AT-002 a created task is listed by GET /api/tasks with status todo", async () => {
  const created = await newTask({ description: "本周工作总结" });
  assert.equal(created.status, "todo");
  const list = await api("GET", "/api/tasks");
  ok(list, "list");
  const found = list.body.tasks.find((t) => t.id === created.id);
  assert.ok(found, "created task not listed");
  assert.equal(found.status, "todo");
});

test("AT-007 PATCH assigneeId persists and GET returns it", async () => {
  const m = await newMember();
  const t = await newTask();
  ok(await api("PATCH", `/api/tasks/${t.id}`, { assigneeId: m.id }), "patch");
  const got = await api("GET", `/api/tasks/${t.id}`);
  ok(got, "get");
  assert.equal(got.body.assigneeId, m.id);
});

test("AT-011 a done task refuses every further transition", async () => {
  const t = await newTask();
  ok(await go(t.id, "in_progress"), "todo→in_progress");
  const done = await go(t.id, "done");
  ok(done, "in_progress→done");
  assert.equal(done.body.status, "done");
  for (const to of ["in_progress", "todo"]) {
    const r = await go(t.id, to);
    assert.ok(r.status >= 400, `done→${to} accepted (HTTP ${r.status})`);
  }
  assert.equal((await api("GET", `/api/tasks/${t.id}`)).body.status, "done");
});

test("AT-017 a duplicate member name is refused and the roster is unchanged", async () => {
  const name = `重复-${uid()}`;
  ok(await api("POST", "/api/members", { name }), "first add");
  const before = (await api("GET", "/api/members")).body.members.length;
  const dup = await api("POST", "/api/members", { name });
  assert.ok(dup.status >= 400, `duplicate accepted (HTTP ${dup.status})`);
  assert.equal((await api("GET", "/api/members")).body.members.length, before);
});

test("AT-019 deleting a member unassigns their tasks, which remain", async () => {
  const m = await newMember();
  const t = await newTask({ assigneeId: m.id });
  ok(await api("DELETE", `/api/members/${m.id}`), "delete member");
  const got = await api("GET", `/api/tasks/${t.id}`);
  ok(got, "task still there");
  assert.equal(got.body.assigneeId, null);
  assert.ok(!(await api("GET", "/api/members")).body.members.some((x) => x.id === m.id), "member still listed");
});

test("AT-022 a task created by one request is read by an independent one", async () => {
  const t = await newTask();
  const fresh = await fetch(new URL("/api/tasks", BASE), { headers: { "cache-control": "no-cache" } }).then((r) => r.json());
  const found = fresh.tasks.find((x) => x.id === t.id);
  assert.ok(found, "not visible to a second request");
  assert.equal(found.title, t.title);
});

test("AT-023 WF-01: legal transitions pass, illegal ones are refused", async () => {
  const a = await newTask();
  const skip = await go(a.id, "done");
  assert.ok(skip.status >= 400, `todo→done accepted (HTTP ${skip.status})`);
  ok(await go(a.id, "in_progress"), "todo→in_progress");
  ok(await go(a.id, "todo"), "in_progress→todo");
  ok(await go(a.id, "in_progress"), "todo→in_progress again");
  ok(await go(a.id, "done"), "in_progress→done");
  const back = await go(a.id, "in_progress");
  assert.ok(back.status >= 400, `done→in_progress accepted (HTTP ${back.status})`);
});

test("contract: an unknown task id is a 404", async () => {
  const r = await api("GET", `/api/tasks/no-such-task-${uid()}`);
  assert.equal(r.status, 404);
});
