/* ============================================================
   task.js — окно задачи
   ============================================================ */
/* --- задача --- */
let editingTask = null;
function openTask(id) {
  const rel = activeRelease();
  if (!rel) {
    toast("Сначала создайте релиз");
    return;
  }
  if (!state.people.length) {
    toast("Сначала заведите сотрудников");
    return;
  }
  editingTask = id || null;
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  $("#taskTitle").textContent = t ? "Редактирование задачи" : "Новая задача";
  $("#tPerson").innerHTML = state.people
    .map(
      (p) => `<option value="${p.id}">${esc(p.name || "Без имени")}</option>`,
    )
    .join("");
  $("#tPerson").value = t ? t.personId : state.people[0].id;
  $("#tStart").min = rel.start;
  $("#tStart").max = rel.end;
  $("#tStart").value = t ? t.start : rel.start;
  $("#tDays").value = t ? t.days : 1;
  $("#tType").value = t ? t.type || "task" : "task";
  $("#tNum").value = t ? t.number || "" : "";
  $("#tDesc").value = t ? t.title || "" : "";
  $("#tErr").textContent = "";
  $("#tDelete").style.display = t ? "" : "none";
  $("#tSave").textContent = t ? "Подтвердить" : "Добавить";
  openModal("#mTask");
  setTimeout(() => $("#tDays").focus(), 50);
}
$("#tSave").addEventListener("click", () => {
  const rel = activeRelease();
  const personId = $("#tPerson").value;
  const start = $("#tStart").value;
  const days = parseFloat($("#tDays").value);
  const type = $("#tType").value;
  const number = $("#tNum").value.trim();
  const title = $("#tDesc").value.trim();
  const err = $("#tErr");

  if (!personId) {
    err.textContent = "Выберите исполнителя";
    return;
  }
  if (!start) {
    err.textContent = "Укажите дату начала";
    return;
  }
  if (!(days > 0)) {
    err.textContent = "Время должно быть больше 0";
    return;
  }
  if (diffDays(rel.start, start) < 0 || diffDays(start, rel.end) < 0) {
    err.textContent = "Дата вне периода релиза";
    return;
  }
  if (
    diffDays(start, addDays(rel.start, 0)) >= 0 &&
    diffDays(rel.start, start) + days > diffDays(rel.start, rel.end) + 1
  ) {
    err.textContent = "Задача выходит за границы релиза";
    return;
  }
  if (editingTask) {
    const t = state.tasks.find((x) => x.id === editingTask);
    Object.assign(t, { personId, start, days, type, number, title });
    toast("Задача обновлена");
  } else {
    state.tasks.push({
      id: uid(),
      releaseId: rel.id,
      personId,
      start,
      days,
      type,
      number,
      title,
    });
    toast("Задача добавлена");
  }
  save();
  render();
  closeModal("#mTask");
});
$("#tDelete").addEventListener("click", () => {
  if (!editingTask) return;
  if (!confirm("Удалить задачу?")) return;
  state.tasks = state.tasks.filter((t) => t.id !== editingTask);
  save();
  render();
  closeModal("#mTask");
  toast("Задача удалена");
});
