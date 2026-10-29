/* ============================================================
   features/release.js — окно релиза: создание, правка, удаление.
   ============================================================ */
import { $, toast } from "../core/dom.js";
import { addDays, diffDays, todayISO } from "../core/dates.js";
import { state, save } from "../core/storage.js";
import { uid } from "../core/util.js";
import { render } from "../core/render.js";
import { closeModal, openModal } from "../ui/modal.js";

let editingId = null;

export function openRelease(id) {
  editingId = id;
  const release = id ? state.releases.find((r) => r.id === id) : null;
  $("#relTitle").textContent = release
    ? "Редактирование релиза"
    : "Новый релиз";
  $("#rNum").value = release ? release.number : nextRelNumber();
  const start = release ? release.start : todayISO();
  $("#rStart").value = start;
  $("#rEnd").value = release ? release.end : addDays(start, 9);
  $("#rErr").textContent = "";
  $("#rDelete").hidden = !release;
  openModal("#mRelease");
  setTimeout(() => $("#rNum").focus(), 50);
}

/* следующий номер: увеличиваем последний числовой сегмент
   (54.5 → 54.6, 0.54 → 0.55, 7 → 8) */
export function nextRelNumber() {
  if (!state.releases.length) return "1.0";
  const last = state.releases[state.releases.length - 1].number;
  const raw = String(last == null ? "" : last).trim();
  if (!raw) return "1.0";
  const parts = raw.split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!/^\d+$/.test(parts[i])) continue;
    const next = parseInt(parts[i], 10) + 1;
    // сохраняем ширину номера с ведущими нулями: 0.054 → 0.055
    const keepPad = parts[i].length > 1 && parts[i][0] === "0";
    parts[i] = keepPad
      ? String(next).padStart(parts[i].length, "0")
      : String(next);
    return parts.join(".");
  }
  // в номере нет ни одного числа (например, «RC») — нумеруем заново
  return raw + ".1";
}

function saveRelease() {
  const number = $("#rNum").value.trim();
  const start = $("#rStart").value;
  const end = $("#rEnd").value;
  const err = $("#rErr");

  if (!number) {
    err.textContent = "Укажите номер релиза";
    return;
  }
  if (!start || !end) {
    err.textContent = "Укажите обе даты";
    return;
  }
  if (diffDays(start, end) < 0) {
    err.textContent = "Дата окончания раньше даты начала";
    return;
  }
  if (diffDays(start, end) > 366) {
    err.textContent = "Слишком длинный период (макс. 366 дней)";
    return;
  }

  if (editingId) {
    const release = state.releases.find((r) => r.id === editingId);
    release.number = number;
    release.start = start;
    release.end = end;
    toast("Релиз обновлён");
  } else {
    const release = { id: uid(), number, start, end };
    state.releases.push(release);
    state.activeId = release.id;
    toast("Релиз создан");
  }

  save();
  render();
  closeModal("#mRelease");
}

export function deleteRelease(id, fromModal = false) {
  const release = state.releases.find((r) => r.id === id);
  if (!release) return;
  if (!confirm(`Удалить релиз ${release.number} и все его задачи?`)) return;

  state.releases = state.releases.filter((r) => r.id !== id);
  state.tasks = state.tasks.filter((t) => t.releaseId !== id);
  if (state.activeId === id) {
    state.activeId = state.releases.length
      ? state.releases[state.releases.length - 1].id
      : null;
  }

  save();
  render();
  if (fromModal) closeModal("#mRelease");
  toast("Релиз удалён");
}

export function initRelease() {
  $("#rSave").addEventListener("click", saveRelease);
  $("#rDelete").addEventListener("click", () => deleteRelease(editingId, true));
}
