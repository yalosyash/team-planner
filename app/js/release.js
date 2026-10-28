/* ============================================================
   release.js — окно релиза
   ============================================================ */
/* --- релиз --- */
let editingRel = null;
function openRelease(id) {
  editingRel = id;
  const rel = id ? state.releases.find((r) => r.id === id) : null;
  $("#relTitle").textContent = rel ? "Редактирование релиза" : "Новый релиз";
  $("#rNum").value = rel ? rel.number : nextRelNum();
  const st = rel ? rel.start : todayISO();
  $("#rStart").value = st;
  $("#rEnd").value = rel ? rel.end : addDays(st, 9);
  $("#rErr").textContent = "";
  $("#rDelete").style.display = rel ? "" : "none";
  openModal("#mRelease");
  setTimeout(() => $("#rNum").focus(), 50);
}
function nextRelNum() {
  if (!state.releases.length) return "1.0";
  // берём последний релиз по позиции в списке и увеличиваем последний
  // числовой сегмент: 54.5 → 54.6, 0.54 → 0.55, 7 → 8
  const last = state.releases[state.releases.length - 1].number;
  const raw = String(last == null ? "" : last).trim();
  if (!raw) return "1.0";
  const parts = raw.split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!/^\d+$/.test(parts[i])) continue;
    const n = parseInt(parts[i], 10) + 1;
    // сохраняем ширину номера с ведущими нулями: 0.054 → 0.055
    const keepPad = parts[i].length > 1 && parts[i][0] === "0";
    parts[i] = keepPad ? String(n).padStart(parts[i].length, "0") : String(n);
    return parts.join(".");
  }
  // в номере нет ни одного числа (например, «RC») — нумеруем заново
  return raw + ".1";
}
$("#rSave").addEventListener("click", () => {
  const num = $("#rNum").value.trim();
  const a = $("#rStart").value,
    b = $("#rEnd").value;
  if (!num) {
    $("#rErr").textContent = "Укажите номер релиза";
    return;
  }
  if (!a || !b) {
    $("#rErr").textContent = "Укажите обе даты";
    return;
  }
  if (diffDays(a, b) < 0) {
    $("#rErr").textContent = "Дата окончания раньше даты начала";
    return;
  }
  if (diffDays(a, b) > 366) {
    $("#rErr").textContent = "Слишком длинный период (макс. 366 дней)";
    return;
  }
  if (editingRel) {
    const rel = state.releases.find((r) => r.id === editingRel);
    rel.number = num;
    rel.start = a;
    rel.end = b;
    toast("Релиз обновлён");
  } else {
    const rel = { id: uid(), number: num, start: a, end: b };
    state.releases.push(rel);
    state.activeId = rel.id;
    toast("Релиз создан");
  }
  save();
  render();
  closeModal("#mRelease");
});
$("#rDelete").addEventListener("click", () => deleteRelease(editingRel, true));

function deleteRelease(id, fromModal) {
  const rel = state.releases.find((r) => r.id === id);
  if (!rel) return;
  if (!confirm(`Удалить релиз ${rel.number} и все его задачи?`)) return;
  state.releases = state.releases.filter((r) => r.id !== id);
  state.tasks = state.tasks.filter((t) => t.releaseId !== id);
  if (state.activeId === id)
    state.activeId = state.releases.length
      ? state.releases[state.releases.length - 1].id
      : null;
  save();
  render();
  if (fromModal) closeModal("#mRelease");
  toast("Релиз удалён");
}
