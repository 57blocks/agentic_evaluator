import { expect, test, type Page } from "@playwright/test";

/**
 * AT-021/022/023 落在 T-020（本域拓扑最靠后的任务）只是记账位置——它们测的是
 * T-011/T-012 已经做完的编辑与删除行为（AC-012/013/015），与本任务自己的状态
 * 流水/定时推进无关。AT-022 现在必然是红的：InvoiceList.tsx 的 Action 列从未
 * 被任何任务加上 `invoice-edit-btn`（详情页与编辑页都各自能进，但列表行里从
 * 没有一个入口链接到编辑页）。
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

function draftDetailBody(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: "INV-E2E-002",
    invoiceType: "Regular",
    status: "Draft",
    fromName: "E2E Merchant Org",
    fromLogoUrl: "",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    createTime: new Date().toISOString(),
    client: { clientId: "c1", clientName: "Bob", clientEmail: "bob@example.com", status: "Active" },
    ccRecipients: [],
    paymentTokens: ["Tron-USDT"],
    items: [{ itemId: "i1", itemName: "Consulting", qty: 1, unitPrice: "100.00", discount: "0.00", tax: "0.00", amount: "100.00" }],
    overallDiscount: "0.00",
    amountWithoutTax: "100.00",
    totalTaxAmount: "0.00",
    discountAmount: "0.00",
    totalAmount: "100.00",
    ...overrides,
  };
}

test.describe("Invoice Edit/Delete e2e", () => {
  test("AT-021：编辑草稿保存后 global-toast 显示成功提示", async ({ page }) => {
    await mockAuthSession(page);

    await page.route("**/api/invoices/INV-E2E-002", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(draftDetailBody()) });
        return;
      }
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ invoiceId: "INV-E2E-002", status: "Draft", totalAmount: "100.00", updateTime: new Date().toISOString() }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto("/apps/invoice/invoices/INV-E2E-002/edit?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("invoice-save-draft-btn")).toBeVisible();
    await page.getByTestId("invoice-save-draft-btn").click();

    await expect(page.getByTestId("global-toast")).toContainText("Successfully edited the draft invoice");
  });

  test("AT-022：Pending 发票所在行的 invoice-edit-btn 处于禁用态且点击不跳转", async ({ page }) => {
    await mockAuthSession(page);

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
              invoiceId: "INV-E2E-003",
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

    await page.goto("/apps/invoice/invoices?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("invoice-row")).toBeVisible();
    const editBtn = page.getByTestId("invoice-edit-btn");
    await expect(editBtn).toBeDisabled();
    await editBtn.click({ force: true });
    await expect(page).toHaveURL(/\/apps\/invoice\/invoices$/);
  });

  test("AT-023：删除请求失败时草稿仍在列表，global-toast 显示失败提示", async ({ page }) => {
    await mockAuthSession(page);

    await page.route("**/api/invoices/INV-E2E-002", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(draftDetailBody()) });
        return;
      }
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "INTERNAL_ERROR", message: "Something went wrong." }),
        });
        return;
      }
      await route.fallback();
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
              invoiceId: "INV-E2E-002",
              createTime: new Date().toISOString(),
              invoiceType: "Regular",
              clientId: "c1",
              clientName: "Bob",
              totalAmount: "100.00",
              status: "Draft",
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
        body: JSON.stringify({ counts: [{ status: "Draft", count: 1 }], total: 1 }),
      });
    });

    await page.goto("/apps/invoice/invoices/INV-E2E-002/edit?portalToken=e2e-test-portal-token");

    await page.getByTestId("invoice-delete-btn").click();
    await expect(page.getByTestId("invoice-delete-modal")).toBeVisible();
    await page.getByTestId("invoice-delete-confirm-btn").click();

    await expect(page.getByTestId("global-toast")).toContainText("Failed to delete the draft invoice");

    await page.goto("/apps/invoice/invoices?portalToken=e2e-test-portal-token");
    await expect(page.getByTestId("invoice-row")).toContainText("Bob");
  });
});
