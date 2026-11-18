import { expect, test, type Page } from "@playwright/test";

/**
 * AT-044/049 落在 T-025（本域拓扑最靠后的任务）只是记账位置——它们测的是
 * T-022/T-023/T-024 已经做完的结算向导行为（AC-030/AC-029），与本任务自己
 * 的结算详情页无关。AT-045（AC-031，Confirm 页缺地址时禁用）在 DEC-015
 * 的 location.state 向导设计下没有可达的浏览器导航路径——Request 页的
 * Next 按钮本身在 entryId 缺失时就已禁用，永远走不到 Confirm 页——因此
 * AT-045 改写为 SettlementConfirm.test.tsx 里直接构造 location.state 的
 * 组件级用例，不在本文件里。
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

async function mockSettlementWizardReads(page: Page): Promise<void> {
  await page.route("**/api/org/destinations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ destinationId: "dest-1", name: "Operations Wallet" }] }),
    });
  });
  await page.route("**/api/org/destinations/*/entries*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ entryId: "entry-1", address: "TAddressXYZ", chainId: "TRON" }] }),
    });
  });
  await page.route("**/api/settlements/settleable-invoices*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            invoiceId: "INV-E2E-SETTLE-1",
            clientName: "Bob",
            paidToken: "Tron-USDT",
            paidAmount: "100.00",
            status: "Received",
            receivedTime: new Date().toISOString(),
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    });
  });
}

test.describe("Settlement Request → Confirm e2e", () => {
  test("AT-044：一张发票都没勾选时 settlement-next-btn 处于禁用态", async ({ page }) => {
    await mockAuthSession(page);
    await mockSettlementWizardReads(page);

    await page.goto("/apps/invoice/settlements/new?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("settlement-invoice-row")).toBeVisible();
    await expect(page.getByTestId("settlement-next-btn")).toBeDisabled();
  });

  test("AT-049：提交成功后 global-toast 显示 `Settlement Request submitted successfully.`", async ({ page }) => {
    await mockAuthSession(page);
    await mockSettlementWizardReads(page);

    await page.route("**/api/settlements/estimate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invoiceCount: 1,
          requestAmount: "100.00",
          coboPayEstimatedFee: "1.50",
          invoiceServiceFee: "0.00",
          totalEstimatedFee: "1.50",
        }),
      });
    });
    await page.route("**/api/settlements", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: "SR-E2E-0001",
          status: "In Progress",
          settlementToken: "Tron-USDT",
          invoiceCount: 1,
          requestAmount: "100.00",
          coboPayEstimatedFee: "1.50",
          invoiceServiceFee: "0.00",
          totalEstimatedFee: "1.50",
          removedInvoiceIds: [],
        }),
      });
    });
    await page.route("**/api/settlements?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }),
      });
    });
    await page.route("**/api/settlements/summary", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ pendingByToken: [] }),
      });
    });

    await page.goto("/apps/invoice/settlements/new?portalToken=e2e-test-portal-token");

    await page.getByTestId("settlement-invoice-checkbox").check();
    await expect(page.getByTestId("settlement-next-btn")).toBeEnabled();
    await page.getByTestId("settlement-next-btn").click();

    await expect(page.getByTestId("settlement-confirm-page")).toBeVisible();
    await expect(page.getByTestId("settlement-confirm-btn")).toBeEnabled();
    await page.getByTestId("settlement-confirm-btn").click();

    await expect(page.getByTestId("global-toast")).toContainText("Settlement Request submitted successfully.");
  });
});
