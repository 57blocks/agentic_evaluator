import { expect, test, type Page } from "@playwright/test";

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

function recurringDetailBody(seriesStatus: "Active" | "Discontinued") {
  return {
    invoiceId: "INV-E2E-REC",
    invoiceType: "Recurring",
    status: "Pending",
    fromName: "E2E Merchant Org",
    fromLogoUrl: "",
    issueDate: "2026-01-01",
    dueDate: "2026-02-01",
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
    series: {
      seriesId: "SR-E2E-001",
      status: seriesStatus,
      frequency: "Monthly",
      endType: "No End Date",
      nextSendDate: "2026-03-01",
    },
  };
}

test.describe("Recurring Discontinue e2e", () => {
  test("AT-057：详情页确认停止后周期区域显示已停止，且不再出现停止入口", async ({ page }) => {
    await mockAuthSession(page);

    let discontinued = false;
    await page.route("**/api/invoices/INV-E2E-REC", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recurringDetailBody(discontinued ? "Discontinued" : "Active")),
      });
    });
    await page.route("**/api/recurring-series/SR-E2E-001/status", async (route) => {
      discontinued = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ seriesId: "SR-E2E-001", status: "Discontinued" }),
      });
    });

    await page.goto("/apps/invoice/invoices/INV-E2E-REC?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("invoice-detail-recurring")).toBeVisible();
    await expect(page.getByTestId("recurring-discontinue-btn")).toBeVisible();

    await page.getByTestId("recurring-discontinue-btn").click();
    await expect(page.getByTestId("recurring-discontinue-modal")).toBeVisible();
    await page.getByTestId("recurring-discontinue-confirm-btn").click();

    await expect(page.getByTestId("invoice-detail-recurring")).toContainText("Discontinued");
    await expect(page.getByTestId("recurring-discontinue-btn")).toHaveCount(0);
  });
});
