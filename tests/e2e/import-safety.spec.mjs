import { test, expect } from "./fixtures.mjs";

test("A01: импортированные ID остаются данными в HTML и формах", async ({
  page,
  installation,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/calendar?*", (route) =>
    route.fulfill({ status: 503, body: "offline" }),
  );
  const id = (prefix) =>
    `${prefix}"><img src=x onerror="window.__auditMarker=1">&'[]\\`;
  const personId = id("person");
  const releaseId = id("release");
  const taskId = id("task");
  const board = {
    version: 4,
    team: "Проверка импорта",
    people: [{ id: personId, name: "Анна", color: "#9db8f5" }],
    releases: [{
      id: releaseId, number: "QA", start: "2026-11-16", end: "2026-11-20",
    }],
    tasks: [{
      id: taskId, releaseId, personId, start: "2026-11-16",
      days: 1, type: "task", number: "123", title: "Проверка",
      labels: [], weekend: false, daysMode: "work",
    }],
  };
  await page.goto(installation.origin);
  await expect(page.getByText("Добавьте сотрудников", { exact: true })).toBeVisible();
  await page.locator("#fileImport").setInputFiles({
    name: "board.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(board)),
  });
  await expect(page.locator(".tab")).toHaveAttribute("data-rel", releaseId);
  await expect(page.locator(".tab [data-edit]")).toHaveAttribute("data-edit", releaseId);
  await expect(page.locator(".tab [data-del]")).toHaveAttribute("data-del", releaseId);
  await expect(page.locator(".card").first()).toHaveAttribute("data-task", taskId);
  await page.locator(".card").first().click();
  await expect(page.locator("#tPerson")).toHaveValue(personId);
  await page.locator("#tSave").click();
  await page.getByRole("button", { name: "Сотрудники", exact: true }).click();
  await expect(page.locator(".prow")).toHaveAttribute("data-id", personId);
  await page.locator(".prow [data-n]").fill("Анна после импорта");
  await page.locator("#pDone").click();
  await page.locator(".tab [data-edit]").click();
  await expect(page.locator("#rNum")).toHaveValue("QA");
  await page.locator("#rSave").click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__auditMarker)).toBeUndefined();
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".tab")).toHaveAttribute("data-rel", releaseId);
  await expect(page.locator(".card").first()).toHaveAttribute("data-task", taskId);
  await expect(page.locator(".pname")).toHaveText("Анна после импорта");
  expect(await page.evaluate(() => window.__auditMarker)).toBeUndefined();
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
