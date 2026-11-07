import { $, esc, toast } from "../core/dom.js";
import { state, replaceState, save, backend } from "../core/storage.js";
import {
  exportRelease,
  previewRelease,
  applyRelease,
  importRevision,
} from "../core/release-transfer.js";
import { render } from "../core/render.js";
import { openModal, closeModal } from "../ui/modal.js";

export const BACKUP_KEY = "team-planner-release-backup";
export function downloadJson(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year.slice(-2)}`;
}
function openExportChoice() {
  const select = $("#reRelease");
  select.replaceChildren(
    select.querySelector("button"),
    ...[...state.releases]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((release) => {
        const option = document.createElement("option");
        option.value = release.id;
        const number = document.createElement("strong");
        number.textContent = release.number;
        const dates = document.createElement("span");
        dates.textContent = `: ${formatDate(release.start)} — ${formatDate(release.end)}`;
        option.append(number, dates);
        return option;
      }),
  );
  if (state.releases.some((r) => r.id === state.activeId))
    select.value = state.activeId;
  select.disabled = !state.releases.length;
  $("#reExport").disabled = !state.releases.length;
  $("#reHint").textContent = state.releases.length
    ? "В файл войдут задачи выбранного релиза и сотрудники с задачами."
    : "Релизов пока нет. Сначала создайте релиз.";
  openModal("#mReleaseExport");
  select.focus();
}
function exportSelected() {
  try {
    const { next, packet } = exportRelease(state, $("#reRelease").value);
    const releaseName =
      packet.release.number
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .trim()
        .replace(/[. ]+$/g, "") || "release";
    downloadJson(
      packet,
      `team-planner-release-${releaseName}-${new Date().toISOString().slice(0, 10)}.json`,
    );
    replaceState(next);
    save();
    closeModal("#mReleaseExport");
    toast("Релиз экспортирован");
  } catch (error) {
    alert(error.message);
  }
}

let pending = null;
function syncApplyButton() {
  const preview = pending && previewRelease(state, pending.packet);
  $("#riApply").disabled =
    !preview ||
    preview.repeated ||
    (!!preview.release && !$("#riConfirm").checked);
}
function showPreview(packet) {
  const preview = previewRelease(state, packet);
  pending = { packet, revision: importRevision(state) };
  const number = document.createElement("strong");
  number.textContent = packet.release.number;
  const taskCount = document.createElement("strong");
  taskCount.textContent = packet.tasks.length;
  $("#riSummary").replaceChildren(
    `${preview.release ? "Обновление" : "Добавление"} релиза `,
    number,
    `: ${formatDate(packet.release.start)} — ${formatDate(packet.release.end)}.`,
    document.createElement("br"),
    "Всего задач: ",
    taskCount,
    `. Добавлено: ${preview.added}, изменено: ${preview.changed}, удалено: ${preview.deleted}.`,
  );
  const warnings = [];
  if (preview.repeated)
    warnings.push(
      "Этот файл уже импортирован. Повторная загрузка заблокирована.",
    );
  if (!preview.repeated && preview.stale)
    warnings.push(
      "Возможно, это старая версия релиза. При замене последние изменения могут быть потеряны.",
    );
  if (!preview.repeated && preview.conflict)
    warnings.push(
      "Обнаружены параллельные правки: текущий релиз отличается от исходного снимка передачи.",
    );
  if (!preview.repeated && preview.unchanged)
    warnings.push("Содержимое релиза не изменилось.");
  $("#riWarning").textContent = warnings.join(" ");
  $("#riConfirmWrap").hidden = !preview.release || preview.repeated;
  $("#riConfirm").checked = false;
  syncApplyButton();
  $("#riApply").textContent = preview.release
    ? "Заменить релиз"
    : "Добавить релиз";
  $("#riError").textContent = "";
  const rows = $("#riPeople");
  rows.replaceChildren();
  const savedMapping = new Map(
    (preview.release?.exchange?.people || [])
      .filter(
        (pair) =>
          packet.people.some((p) => p.id === pair.remote) &&
          state.people.some((p) => p.id === pair.local),
      )
      .map((pair) => [pair.remote, pair.local]),
  );
  const assigned = new Set(savedMapping.values());
  packet.people.forEach((person) => {
    const row = document.createElement("label");
    row.textContent = `${person.name} → `;
    const select = document.createElement("select");
    select.dataset.person = person.id;
    select.innerHTML =
      '<option value="" disabled selected hidden>Выберите сотрудника</option><option value="new">Добавить нового</option>' +
      state.people
        .map(
          (p, index) =>
            `<option value="${esc(p.id)}">${esc(p.name)} (№${index + 1})${p.name === person.name ? " — совпадает имя" : ""}</option>`,
        )
        .join("");
    const saved = savedMapping.get(person.id);
    const matches = state.people.filter((p) => p.name === person.name);
    if (saved) select.value = saved;
    else if (!state.people.length) select.value = "new";
    else if (
      matches.length === 1 &&
      !assigned.has(matches[0].id) &&
      packet.people.filter((p) => p.name === person.name).length === 1
    ) {
      select.value = matches[0].id;
      assigned.add(matches[0].id);
    }
    row.append(select);
    rows.append(row);
  });
  openModal("#mReleaseImport");
}

async function applyPending() {
  const button = $("#riApply");
  const operation = pending;
  try {
    if (!pending) return;
    if (importRevision(state) !== pending.revision) {
      showPreview(pending.packet);
      throw new Error(
        "Данные изменились во время предпросмотра. Проверьте обновлённый предпросмотр и выберите сотрудников заново.",
      );
    }
    const preview = previewRelease(state, pending.packet);
    if (preview.release && !$("#riConfirm").checked) return;
    const mapping = new Map(
      [...$("#riPeople").querySelectorAll("select")].map((s) => [
        s.dataset.person,
        s.value,
      ]),
    );
    applyRelease(state, pending.packet, mapping); // проверяем выбор до резервирования
    const before = JSON.stringify(state);
    button.disabled = true;
    // Сохраняем именно состояние в памяти, включая ещё не записанные правки.
    if (backend === "server") {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: before,
      });
      if (!response.ok || !(await response.json()).ok)
        throw new Error(
          "Не удалось создать резервную копию. Импорт отменён. Если сервер запущен до обновления кода, перезапустите его.",
        );
    } else {
      localStorage.setItem(BACKUP_KEY, before);
      if (localStorage.getItem(BACKUP_KEY) !== before)
        throw new Error("Не удалось создать резервную копию");
    }
    if (
      pending !== operation ||
      !$("#mReleaseImport").classList.contains("open")
    )
      return;
    if (importRevision(state) !== pending.revision)
      throw new Error(
        "Данные изменились во время резервного копирования. Откройте файл заново.",
      );
    // Берём актуальный календарь и настройки, включая обновления за время запроса.
    replaceState(applyRelease(state, pending.packet, mapping));
    save();
    render();
    pending = null;
    closeModal("#mReleaseImport");
    toast("Релиз импортирован");
  } catch (error) {
    $("#riError").textContent = error.message;
  } finally {
    syncApplyButton();
  }
}

export function initReleaseTransfer() {
  $("#riConfirm").addEventListener("change", syncApplyButton);
  $("#btnExportRelease").addEventListener("click", openExportChoice);
  $("#reExport").addEventListener("click", exportSelected);
  $("#btnImportRelease").addEventListener("click", () =>
    $("#fileReleaseImport").click(),
  );
  $("#fileReleaseImport").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Файл слишком большой (максимум 10 МБ)");
      showPreview(JSON.parse(await file.text()));
    } catch (error) {
      alert("Не удалось загрузить релиз: " + error.message);
    }
  });
  $("#riApply").addEventListener("click", applyPending);
  $("#riDownloadCurrent").addEventListener("click", () => {
    downloadJson(state, "team-planner-before-import.json");
  });
}
