// Held-out API probes for invoice, black box over HTTP (API_URL), from
// _contracts/api-routes.json only. Merchant endpoints sit behind a Cobo-signed
// portal login that a grader cannot mint, so these probe what the contract
// fixes without logging in: the public endpoints answer as specified, and every
// protected endpoint is routed and guarded (401/403, never 404 or 5xx).
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_URL;
if (!BASE) throw new Error("API_URL is not set");

const PROTECTED = [
  ["GET", "/api/org/profile"], ["GET", "/api/org/destinations"], ["GET", "/api/org/destinations/d-1/entries"],
  ["GET", "/api/clients"], ["POST", "/api/clients"], ["PATCH", "/api/clients/c-1"], ["PUT", "/api/clients/c-1/status"],
  ["GET", "/api/invoices"], ["GET", "/api/invoices/status-counts"], ["POST", "/api/invoices"], ["GET", "/api/invoices/INV-1"],
  ["PATCH", "/api/invoices/INV-1"], ["DELETE", "/api/invoices/INV-1"], ["POST", "/api/invoices/INV-1/send"], ["POST", "/api/invoices/INV-1/void"],
  ["PUT", "/api/recurring-series/s-1/status"],
  ["GET", "/api/settlements"], ["GET", "/api/settlements/summary"], ["GET", "/api/settlements/settleable-invoices"],
  ["POST", "/api/settlements/estimate"], ["POST", "/api/settlements"], ["GET", "/api/settlements/r-1"],
  ["GET", "/api/dashboard/invoice-sent"], ["GET", "/api/dashboard/unreceived"], ["GET", "/api/dashboard/received-by-token"], ["GET", "/api/dashboard/last-received"],
];

async function call(method, path, body, headers = {}) {
  const res = await fetch(new URL(path, BASE), {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, body: json };
}

test("GET /api/health answers 200 with status ok", async () => {
  const r = await call("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body?.status, "ok");
});

test("POST /api/auth/session refuses a forged portal token with a 4xx", async () => {
  const r = await call("POST", "/api/auth/session", { portalToken: "not-a-real-cobo-jwt" });
  assert.ok(r.status >= 400 && r.status < 500 && r.status !== 404, `HTTP ${r.status}`);
});

test("GET /api/pay/:token answers an unknown token with a 4xx JSON error, not a crash", async () => {
  const r = await call("GET", "/api/pay/no-such-token-123");
  assert.ok(r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
  assert.ok(r.body !== undefined, "not JSON");
});

for (const [method, path] of PROTECTED) {
  test(`${method} ${path} without a session is refused (401/403)`, async () => {
    const r = await call(method, path, method === "GET" || method === "DELETE" ? undefined : {});
    assert.ok(r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  });
}
