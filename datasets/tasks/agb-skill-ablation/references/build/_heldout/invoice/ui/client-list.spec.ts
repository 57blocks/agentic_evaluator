import { expect, test, type Page } from "@playwright/test";

/**
 * 这几条是本域负责的 e2e 用例（AT-005/006/007），落在 T-009 只是因为它是本域
 * 拓扑最靠后的任务——它们实际测的是 T-006/T-007 已经做完的行为，不是冻结/解冻。
 *
 * 会话建立走真实前端逻辑（RequireSession → exchangePortalToken → POST
 * /api/auth/session），只在网络层用 page.route 打桩，不碰任何后端代码——
 * 这不是伪造外部身份凭证（backend-invariants 第 7 条禁的是后端接受一个
 * mock token），只是把测试的边界画在网络层。
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

async function mockClientsList(
  page: Page,
  items: Array<{
    clientId: string;
    createTime: string;
    clientEmail: string;
    clientType: "Enterprise" | "Personal";
    clientName: string;
    status: "Active" | "Frozen";
  }>,
): Promise<void> {
  await page.route("**/api/clients?*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, page: 1, pageSize: 20, total: items.length }),
    });
  });
}

test.describe("Client List e2e", () => {
  test("AT-005：新增客户后弹窗关闭、列表出现该客户、global-toast 显示成功提示", async ({ page }) => {
    await mockAuthSession(page);
    await mockClientsList(page, []);

    await page.route("**/api/clients", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      const created = {
        clientId: "999",
        createTime: new Date().toISOString(),
        clientEmail: "e2e-new-client@example.com",
        clientType: "Enterprise",
        clientName: "E2E New Client",
        status: "Active",
      };
      // 提交成功后，列表刷新请求要能看到这条新客户。
      await mockClientsList(page, [created]);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(created),
      });
    });

    await page.goto("/apps/invoice/clients?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("client-list-page")).toBeVisible();
    await expect(page.getByTestId("client-empty")).toBeVisible();

    await page.getByTestId("client-add-btn").click();
    await expect(page.getByTestId("client-modal")).toBeVisible();

    await page.getByTestId("client-email-input").fill("e2e-new-client@example.com");
    await page.getByTestId("client-type-enterprise-radio").check();
    await page.getByTestId("client-name-input").fill("E2E New Client");
    await page.getByTestId("client-modal-submit-btn").click();

    await expect(page.getByTestId("client-modal")).toBeHidden();
    await expect(page.getByTestId("global-toast")).toContainText("Successfully added the client.");
    await expect(page.getByTestId("client-table")).toBeVisible();
    await expect(page.getByTestId("client-row")).toContainText("E2E New Client");
  });

  test("AT-006：无客户时渲染 client-empty 与 client-add-btn，不渲染空表格", async ({ page }) => {
    await mockAuthSession(page);
    await mockClientsList(page, []);

    await page.goto("/apps/invoice/clients?portalToken=e2e-test-portal-token");

    await expect(page.getByTestId("client-list-page")).toBeVisible();
    await expect(page.getByTestId("client-empty")).toBeVisible();
    await expect(page.getByTestId("client-add-btn")).toBeVisible();
    await expect(page.getByTestId("client-table")).toHaveCount(0);
  });

  test("AT-007：无会话访问 Client List 渲染 no-permission-page，不渲染侧栏，且不请求客户列表", async ({
    page,
  }) => {
    const clientListRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/clients")) {
        clientListRequests.push(request.url());
      }
    });

    await page.goto("/apps/invoice/clients");

    await expect(page.getByTestId("no-permission-page")).toBeVisible();
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    expect(clientListRequests).toHaveLength(0);
  });
});
