import { test, expect } from "./fixtures.mjs";

const board = () => ({
  version: 4,
  team: "QA",
  people: [{ id: "p", name: "Анна", color: "#9db8f5" }],
  releases: [{ id: "r", number: "QA", start: "2026-11-16", end: "2026-11-20" }],
  tasks: [],
});
const task = (id, overrides = {}) => ({
  id, personId: "p", releaseId: "r", start: "2026-11-16",
  days: 0.5, type: "task", title: "Проверка", labels: [],
  weekend: false, daysMode: "work", ...overrides,
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/calendar?*", (route) =>
    route.fulfill({ status: 503, body: "offline" }),
  );
});

async function importBoard(page, origin, data) {
  await page.goto(origin);
  await expect(page.getByText("Добавьте сотрудников", { exact: true })).toBeVisible();
  await page.locator("#fileImport").setInputFiles({
    name: "board.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
}

test("A02: доска больше 64 КБ сохраняется и открывается повторно", async ({ page, installation }) => {
  const data = board();
  data.tasks = Array.from({ length: 120 }, (_, i) => task(`t${i}`, { title: "Описание ".repeat(55) }));
  expect(Buffer.byteLength(JSON.stringify(data))).toBeGreaterThan(65536);
  await importBoard(page, installation.origin, data);
  const read = async () => (await (await fetch(installation.origin + "/api/data")).json()).data;
  const saved = await read();
  expect(saved.tasks).toHaveLength(120);
  expect(saved.tasks.every((task) => task.title === data.tasks[0].title)).toBe(true);
  expect(saved.tasks[0].start).toBe("2026-11-16");
  expect(saved.tasks[119].start).toBe("2027-02-05");
  await page.reload();
  await expect(page.locator(".tab")).toHaveCount(1);
  expect(await page.evaluate(async () => {
    const { state, hasUnsaved } = await import("/js/core/storage.js");
    return { count: state.tasks.length, title: state.tasks[119].title, unsaved: hasUnsaved() };
  })).toEqual({ count: 120, title: data.tasks[119].title, unsaved: false });
});

test("A03: демо сохраняется вместе с последующими изменениями", async ({ page, installation }) => {
  await page.goto(installation.origin);
  await page.getByRole("button", { name: "Загрузить демо", exact: true }).click();
  await expect(page.locator(".card").first()).toBeVisible();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Сотрудники", exact: true }).click();
  await page.locator(".prow [data-n]").first().fill("Демо после правки");
  await page.locator("#pDone").click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  const data = (await (await fetch(installation.origin + "/api/data")).json()).data;
  expect(data.tasks.length).toBeGreaterThan(0);
  expect(data.tasks.every((task) => Array.isArray(task.labels))).toBe(true);
  await page.reload();
  await expect(page.locator(".pname").first()).toHaveText("Демо после правки");
  expect(await page.evaluate(async () => {
    const { state } = await import("/js/core/storage.js");
    return state.tasks.length;
  })).toBe(data.tasks.length);
});

test("A04: повреждённые recovery-копии не блокируют серверную доску", async ({ page, installation }) => {
  const data = board();
  await importBoard(page, installation.origin, data);
  await page.evaluate((data) => {
    localStorage.setItem("team-planner-unsaved-v4:broken-json", "{");
    localStorage.setItem("team-planner-unsaved-v4:broken-schema", JSON.stringify({ data: { version: 999 } }));
    localStorage.setItem("team-planner-unsaved-v4:good", JSON.stringify({ data }));
  }, data);
  await page.reload();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Сотрудники", exact: true })).toBeEnabled();
  await expect(page.getByText(/Некоторые локальные копии восстановления повреждены/)).toBeVisible();
  expect(await page.evaluate(() => ({
    json: localStorage.getItem("team-planner-unsaved-v4:broken-json"),
    schema: localStorage.getItem("team-planner-unsaved-v4:broken-schema"),
    good: localStorage.getItem("team-planner-unsaved-v4:good"),
  }))).toEqual({ json: "{", schema: JSON.stringify({ data: { version: 999 } }), good: null });
});

test("A06: запрещённые даты не изменяют релиз и не мешают сохранению", async ({ page, installation }) => {
  await importBoard(page, installation.origin, board());
  await page.locator(".tab [data-edit]").click();
  await page.locator("#rStart").fill("1800-01-01");
  await page.locator("#rEnd").fill("1800-01-02");
  await page.locator("#rSave").click();
  await expect(page.locator("#rErr")).toContainText("1900–2100");
  await expect(page.locator("#mRelease")).toBeVisible();
  expect((await (await fetch(installation.origin + "/api/data")).json()).data).toEqual(board());
  await page.locator("#rStart").fill("2026-11-16");
  await page.locator("#rEnd").fill("2026-11-19");
  await page.locator("#rSave").click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".tab")).toHaveCount(1);
  expect(await page.evaluate(async () => (await import("/js/core/storage.js")).state.releases[0].end)).toBe("2026-11-19");
});

test("A07: статусы сохраняют заливку и рамку в обеих темах", async ({ page, installation }) => {
  const data = board();
  data.tasks = [task("waiting", { status: "waiting" }), task("preprod", { status: "preprod" }), task("plain")];
  await importBoard(page, installation.origin, data);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
    for (const [id, variable] of [["waiting", "--st-wait-line"], ["preprod", "--st-done-line"]]) {
      const styles = await page.locator(`.card[data-task="${id}"]`).first().evaluate((card, variable) => {
        const style = getComputedStyle(card);
        const reference = document.createElement("span");
        reference.style.color = `var(${variable})`;
        card.append(reference);
        const expectedBorder = getComputedStyle(reference).color;
        reference.remove();
        return { image: style.backgroundImage, border: style.borderColor, expectedBorder, fill: style.backgroundColor };
      }, variable);
      expect(styles.image).toContain("linear-gradient");
      expect(styles.border).toBe(styles.expectedBorder);
      const plain = await page.locator('.card[data-task="plain"]').first().evaluate((card) => getComputedStyle(card).backgroundColor);
      expect(styles.fill).toBe(plain);
    }
  }
});

test("A08: неподдерживаемая длительность не меняет доску", async ({ page, installation }) => {
  await importBoard(page, installation.origin, board());
  await page.getByRole("button", { name: "+ Задача", exact: true }).click();
  for (const [days, message] of [["0.001", "Длительность"], ["3000", "Длительность"], ["2000", "2000 календарных дней"]]) {
    await page.locator("#tDays").fill(days);
    await page.locator("#tSave").click();
    await expect(page.locator("#tErr")).toContainText(message);
    await expect(page.locator("#mTask")).toBeVisible();
    expect(await page.evaluate(async () => (await import("/js/core/storage.js")).state.tasks)).toEqual([]);
  }
  await page.locator("#tDays").fill("0.01");
  await page.locator("#tSave").click();
  await expect(page.locator("#mTask")).not.toBeVisible();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".tab")).toHaveCount(1);
  expect(await page.evaluate(async () => (await import("/js/core/storage.js")).state.tasks[0].days)).toBe(0.01);
  const rejected = board();
  rejected.tasks = [task("bad", { days: 3000 })];
  const dialog = page.waitForEvent("dialog");
  await page.locator("#fileImport").setInputFiles({
    name: "bad.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(rejected)),
  });
  const alert = await dialog;
  expect(alert.message()).toContain("Длительность");
  await alert.dismiss();
  expect(await page.evaluate(async () => (await import("/js/core/storage.js")).state.tasks[0].days)).toBe(0.01);
});

test("Редактирование задачи сохраняет метаданные и порядок очереди", async ({ page, installation }) => {
  const data = board();
  data.people.push({ id: "p2", name: "Борис", color: "#b3a3f0" });
  data.tasks = [
    task("moving", { labels: ["FE"], link: "https://example.com/123", exchangeId: "remote-task" }),
    task("existing", { personId: "p2" }),
  ];
  await importBoard(page, installation.origin, data);
  await page.locator('.card[data-task="moving"]').first().click();
  await page.locator("#tPerson").selectOption("p2");
  await page.locator("#tDays").fill("1");
  await page.locator("#tLink").fill("");
  await page.locator("label").filter({ has: page.locator("#tBE") }).click();
  await page.locator("#tSave").click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  let saved = (await (await fetch(installation.origin + "/api/data")).json()).data;
  expect(saved.tasks.map((task) => task.id)).toEqual(["existing", "moving"]);
  expect(saved.tasks[1]).toMatchObject({
    personId: "p2", days: 1, labels: ["FE", "BE"], exchangeId: "remote-task",
  });
  expect(saved.tasks[1]).not.toHaveProperty("link");
  await page.locator('.card[data-task="existing"]').first().click();
  await page.locator("#tDays").fill("0.25");
  await page.locator("#tSave").click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".tab")).toHaveCount(1);
  saved = await page.evaluate(async () => JSON.parse(JSON.stringify((await import("/js/core/storage.js")).state)));
  expect(saved.tasks.map((task) => task.id)).toEqual(["existing", "moving"]);
  expect(saved.tasks[0].days).toBe(0.25);
  expect(saved.tasks[1].exchangeId).toBe("remote-task");
  expect(saved.tasks[1].labels).toEqual(["FE", "BE"]);
});

test("A08: смена календаря сообщает о превышении горизонта и позволяет исправить задачу", async ({ page, installation }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const data = board();
  data.tasks = [task("long", { days: 1400 })];
  await importBoard(page, installation.origin, data);
  await page.evaluate(async () => {
    const { state } = await import("/js/core/storage.js");
    state.calendar.years[2026] = { days: "1".repeat(365) };
    (await import("/js/core/render.js")).render();
  });
  await expect(page.locator("#storeStatus")).toContainText("2000 календарных дней");
  await page.locator('.card[data-task="long"]').first().click();
  await page.locator("#tDays").fill("1");
  await page.locator("#tSave").click();
  await expect(page.locator("#mTask")).not.toBeVisible();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  expect((await (await fetch(installation.origin + "/api/data")).json()).data.tasks[0].days).toBe(1);
  expect(errors).toEqual([]);
});
