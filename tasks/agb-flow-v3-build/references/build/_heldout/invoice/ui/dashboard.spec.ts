import { expect, test, type Page } from "@playwright/test";

/**
 * AT-041/042/043 落在 T-027（本域拓扑最靠后的任务）——AT-041 测的是 T-026 已经
 * 做完的 Invoice Sent 范围校验（AC-026）在真实浏览器里的表现；AT-042/043 测的
 * 是本任务新增的三个面板 + 整页空态 + 无权限守卫（AC-027/028）。
 */
async function mockAuthSession(page: Page): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "e2e-test-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        org: { orgId: "e2e-org", name: "E2E Merchant Org", logoUrl: "/default-org-logo.svg" },
      }),
    });
  });
}

interface DashboardMockOptions {
  invoiceSentDays?: unknown[];
  unreceived?: Record<string, unknown>;
  receivedByToken?: Record<string, unknown>;
  lastReceived?: Record<string, unknown>;
  onInvoiceSentCall?: () => void;
  onAnyDashboardCall?: () => void;
}

const EMPTY_UNRECEIVED = { notDue: "0.00", overdue: "0.00", total: "0.00", overdueInvoiceCount: 0 };
const EMPTY_RECEIVED_BY_TOKEN = { month: "2026-09", byToken: [], total: "0.00" };
const EMPTY_LAST_RECEIVED = {};

async function mockDashboardEndpoints(page: Page, options: DashboardMockOptions = {}): Promise<void> {
  await page.route("**/api/dashboard/invoice-sent*", async (route) => {
    options.onInvoiceSentCall?.();
    options.onAnyDashboardCall?.();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ days: options.invoiceSentDays ?? [] }),
    });
  });
  await page.route("**/api/dashboard/unreceived*", async (route) => {
    options.onAnyDashboardCall?.();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.unreceived ?? EMPTY_UNRECEIVED),
    });
  });
  await page.route("**/api/dashboard/received-by-token*", async (route) => {
    options.onAnyDashboardCall?.();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.receivedByToken ?? EMPTY_RECEIVED_BY_TOKEN),
    });
  });
  await page.route("**/api/dashboard/last-received*", async (route) => {
    options.onAnyDashboardCall?.();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.lastReceived ?? EMPTY_LAST_RECEIVED),
    });
  });
}

test.describe("Dashboard e2e", () => {
  test("AT-041：选择 16 天范围 → dash-range-error 显示提示，且不再对 invoice-sent 发出新请求", async ({ page }) => {
    await mockAuthSession(page);
    let invoiceSentCallCount = 0;
    await mockDashboardEndpoints(page, {
      invoiceSentDays: [
        { date: "2026-09-02", pending: "100.00", received: "0.00", settled: "0.00", error: "0.00", other: "0.00", total: "100.00" },
      ],
      unreceived: { notDue: "50.00", overdue: "10.00", total: "60.00", overdueInvoiceCount: 1 },
      receivedByToken: { month: "2026-09", byToken: [{ paidToken: "Tron-USDT", amount: "30.00", invoiceCount: 1 }], total: "30.00" },
      lastReceived: { last: { invoiceId: "INV-1", clientName: "Acme", paidToken: "Tron-USDT", paidAmount: "30.00", receivedTime: new Date().toISOString() } },
      onInvoiceSentCall: () => {
        invoiceSentCallCount += 1;
      },
    });

    await page.goto("/apps/invoice/dashboard?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("dashboard-page")).toBeVisible();
    await expect(page.getByTestId("chart-invoice-sent")).toBeVisible();
    await expect.poll(() => invoiceSentCallCount).toBeGreaterThan(0);
    const callsBeforeRangeChange = invoiceSentCallCount;

    await page.getByTestId("dash-date-from").fill("2026-08-01");
    await page.getByTestId("dash-date-to").fill("2026-08-20");

    await expect(page.getByTestId("dash-range-error")).toContainText(
      "You cannot select a date range longer than 15 days.",
    );
    await expect(page.getByTestId("chart-invoice-sent")).toHaveCount(0);
    // 给可能存在的异步请求留出一个 tick，再确认调用次数没有增加
    await page.waitForTimeout(200);
    expect(invoiceSentCallCount).toBe(callsBeforeRangeChange);
  });

  test("AT-042：四个指标都无数据时渲染整页空态与创建发票引导，而不是四个空框", async ({ page }) => {
    await mockAuthSession(page);
    await mockDashboardEndpoints(page);

    await page.goto("/apps/invoice/dashboard?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("dashboard-page")).toBeVisible();
    await expect(page.getByTestId("dashboard-empty")).toBeVisible();
    await expect(page.getByTestId("chart-invoice-sent")).toHaveCount(0);
    await expect(page.getByTestId("kpi-unreceived")).toHaveCount(0);
    await expect(page.getByTestId("panel-received-token")).toHaveCount(0);
    await expect(page.getByTestId("panel-last-received")).toHaveCount(0);

    const createInvoiceCta = page.getByTestId("dashboard-empty").getByRole("link", { name: /create.*invoice/i })
      .or(page.getByTestId("dashboard-empty").getByRole("button", { name: /create.*invoice/i }));
    await createInvoiceCta.click();
    await expect(page.getByTestId("invoice-form-page")).toBeVisible();
  });

  test("AT-043：无会话直接访问 Dashboard → 渲染 no-permission-page 且不加载任何指标", async ({ page }) => {
    let dashboardCallCount = 0;
    await mockDashboardEndpoints(page, { onAnyDashboardCall: () => (dashboardCallCount += 1) });

    await page.goto("/apps/invoice/dashboard");

    await expect(page.getByTestId("no-permission-page")).toBeVisible();
    await expect(page.getByTestId("dashboard-page")).toHaveCount(0);
    expect(dashboardCallCount).toBe(0);
  });
});
