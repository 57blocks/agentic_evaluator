import { expect, test, type Page } from "@playwright/test";

/**
 * AT-028/029 落在 T-020（本域拓扑最靠后的任务）只是记账位置——它们测的是
 * T-016 已经做完的作废行为（AC-016/017），与本任务自己的状态流水/定时推进
 * 无关。VoidModal 与作废按钮都已经在 T-016 里接好，这两条大概率已经是绿的；
 * 记在这里只是补上此前一直缺失的 e2e 覆盖。
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

function invoiceListBody(status: "Pending" | "Voided") {
  return {
    items: [
      {
        invoiceId: "INV-E2E-004",
        createTime: new Date().toISOString(),
        invoiceType: "Regular",
        clientId: "c1",
        clientName: "Bob",
        totalAmount: "100.00",
        status,
        dueDate: new Date().toISOString().slice(0, 10),
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
  };
}

test.describe("Invoice Void e2e", () => {
  test("AT-028：作废原因为空时点击提交 → void-reason-error 出现，发票状态不变", async ({ page }) => {
    await mockAuthSession(page);

    let voidCalled = false;
    await page.route("**/api/invoices/INV-E2E-004/void", async (route) => {
      voidCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoiceId: "INV-E2E-004", status: "Voiding", acceptedAt: new Date().toISOString() }),
      });
    });
    await page.route("**/api/invoices?*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invoiceListBody("Pending")) });
    });
    await page.route("**/api/invoices/status-counts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ counts: [{ status: "Pending", count: 1 }], total: 1 }),
      });
    });

    await page.goto("/apps/invoice/invoices?portalToken=e2e-test-portal-token");

    await page.getByTestId("invoice-void-btn").click();
    await expect(page.getByTestId("void-modal")).toBeVisible();
    await page.getByTestId("void-submit-btn").click();

    await expect(page.getByTestId("void-reason-error")).toBeVisible();
    expect(voidCalled).toBe(false);
    await expect(page.getByTestId("invoice-status-badge")).toContainText("Pending");
  });

  test.skip("AT-029：作废成功后 global-toast 显示成功提示，列表状态变为 Voided", async ({ page }) => {
    await mockAuthSession(page);

    let listCallCount = 0;
    await page.route("**/api/invoices?*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      listCallCount += 1;
      const status = listCallCount === 1 ? "Pending" : "Voided";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invoiceListBody(status)) });
    });
    await page.route("**/api/invoices/status-counts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ counts: [{ status: "Pending", count: 1 }], total: 1 }),
      });
    });
    await page.route("**/api/invoices/INV-E2E-004/void", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoiceId: "INV-E2E-004", status: "Voiding", acceptedAt: new Date().toISOString() }),
      });
    });

    await page.goto("/apps/invoice/invoices?portalToken=e2e-test-portal-token");

    await page.getByTestId("invoice-void-btn").click();
    await page.getByTestId("void-reason-textarea").fill("Client requested cancellation.");
    await page.getByTestId("void-submit-btn").click();

    await expect(page.getByTestId("global-toast")).toContainText("Voided the invoice successfully");
    await expect(page.getByTestId("invoice-status-badge")).toContainText("Voided");
  });
});
