import { expect, test, type Page } from "@playwright/test";

test("login screen renders seeded demo hints", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Sign in to StockPilot")).toBeVisible();
  await expect(page.getByText("manager@stockpilot.dev")).toBeVisible();
});

test("manager can sign in and reach the dashboard", async ({ page }) => {
  await loginAs(page, "Manager", "/dashboard");

  await expect(page.getByText("Here's what needs attention", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Count stock/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect Square/i })).toBeVisible();
});

test("staff can open swipe count mode", async ({ page }) => {
  await loginAs(page, "Staff", "/stock-count/swipe");
  await page.goto("/stock-count/swipe");

  await expect(page.getByText("Swipe count mode")).toBeVisible();
  await expect(page.getByRole("button", { name: /Looks right/i }).first()).toBeVisible();
});

test("manager can open settings and see chat connection cards", async ({ page }) => {
  await loginAs(page, "Manager", "/dashboard");
  await page.goto("/settings");

  await expect(page.getByText("Manager chat bot")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Connect WhatsApp|Reconnect WhatsApp|Reissue WhatsApp link/i })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Connect Telegram|Reconnect Telegram|Reissue Telegram link/i })
  ).toBeVisible();
  await expect(page.getByText("Advanced fallback")).toBeVisible();
});

test("manager can open the Telegram connect gateway", async ({ page }) => {
  await loginAs(page, "Manager", "/dashboard");
  await page.goto("/settings");

  await page
    .getByRole("button", {
      name: /Connect Telegram|Reconnect Telegram|Reissue Telegram link/i,
    })
    .click();

  await page.waitForURL("**/settings/telegram/connect**");
  await expect(page.getByText("Open Telegram and connect")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open Telegram bot/i })).toBeVisible();
});

async function loginAs(
  page: Page,
  demoRole: "Manager" | "Staff",
  expectedPath: string
) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(demoRole, "i") }).click();
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL(`**${expectedPath}`);
}
