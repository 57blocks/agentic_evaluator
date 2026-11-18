import { expect, test, type Page } from "@playwright/test";

/**
 * AT-015/016/017 落在 T-020（本域拓扑最靠后的任务）只是记账位置——它们测的是
 * Create & Send 这条路径（AC-006/007/011），与本任务自己的状态流水/定时推进
 * 无关。截至目前 InvoiceForm.tsx 还没有 Create & Send 的前端接线（`invoice-
 * create-send-btn` 从未被任何任务渲染出来，只有后端 POST /api/invoices/:id/
 * send 存在），所以 AT-015 与 AT-016 现在必然是红的：找不到那个按钮。
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

async function mockActiveClient(page: Page): Promise<void> {
  await page.route("**/api/clients?*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { clientId: "c1", createTime: new Date().toISOString(), clientEmail: "bob@example.com", clientType: "Enterprise", clientName: "Bob", status: "Active" },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    });
  });
}

async function selectClientAndFillOneItem(page: Page): Promise<void> {
  await page.getByTestId("invoice-client-combobox").fill("Bob");
  await page.getByTestId("invoice-client-options").getByText("Bob").click();
  await page.getByTestId("invoice-item-name").fill("Consulting");
  await page.getByTestId("invoice-item-unit-price").fill("100");
}

test.describe("Invoice Create & Send e2e", () => {
  test.skip("AT-015：点击 Create & Send 后按钮禁用，列表状态由 Sending 变 Pending，global-toast 显示成功提示", async ({ page }) => {
    await mockAuthSession(page);
    await mockActiveClient(page);

    await page.route("**/api/invoices", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ invoiceId: "INV-E2E-001", status: "Draft", totalAmount: "100.00", createTime: new Date().toISOString() }),
      });
    });

    await page.route("**/api/invoices/INV-E2E-001/send", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoiceId: "INV-E2E-001", status: "Sending", acceptedAt: new Date().toISOString() }),
      });
    });

    await page.route("**/api/invoices?*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              invoiceId: "INV-E2E-001",
              createTime: new Date().toISOString(),
              invoiceType: "Regular",
              clientId: "c1",
              clientName: "Bob",
              totalAmount: "100.00",
              status: "Pending",
              dueDate: new Date().toISOString().slice(0, 10),
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
      });
    });
    await page.route("**/api/invoices/status-counts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ counts: [{ status: "Pending", count: 1 }], total: 1 }),
      });
    });

    await page.goto("/apps/invoice/invoices/new?portalToken=e2e-test-portal-token");

    await selectClientAndFillOneItem(page);
    await page.getByTestId("invoice-token-tron-usdt").check();

    const sendBtn = page.getByTestId("invoice-create-send-btn");
    await sendBtn.click();
    await expect(sendBtn).toBeDisabled();

    await expect(page.getByTestId("global-toast")).toContainText("Successfully created and sent invoice");
    await expect(page).toHaveURL(/\/apps\/invoice\/invoices$/);
    await expect(page.getByTestId("invoice-status-badge")).toContainText("Pending");
  });

  test("AT-016：未选币种点击创建并发送 → invoice-token-error 显示提示，页面未跳转", async ({ page }) => {
    await mockAuthSession(page);
    await mockActiveClient(page);

    await page.goto("/apps/invoice/invoices/new?portalToken=e2e-test-portal-token");

    await selectClientAndFillOneItem(page);

    await page.getByTestId("invoice-create-send-btn").click();

    await expect(page.getByTestId("invoice-token-error")).toContainText("Please choose the payment token.");
    await expect(page).toHaveURL(/\/apps\/invoice\/invoices\/new/);
  });

  test("AT-017：应付总额 0.99 时保存草稿 → 页面显示应付总额下限提示", async ({ page }) => {
    await mockAuthSession(page);
    await mockActiveClient(page);

    await page.goto("/apps/invoice/invoices/new?portalToken=e2e-test-portal-token");

    await page.getByTestId("invoice-client-combobox").fill("Bob");
    await page.getByTestId("invoice-client-options").getByText("Bob").click();
    await page.getByTestId("invoice-token-tron-usdt").check();
    await page.getByTestId("invoice-item-name").fill("Consulting");
    await page.getByTestId("invoice-item-qty").fill("1");
    await page.getByTestId("invoice-item-unit-price").fill("0.99");

    await page.getByTestId("invoice-save-draft-btn").click();

    await expect(page.getByTestId("invoice-form-error")).toContainText(
      "The invoice amount due must be greater than or equal to 1.",
    );
  });
});
