/* ============================================================
   data-io.js — экспорт, импорт и версии данных
   ============================================================ */
/* ============ экспорт / импорт ============ */
$("#btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "team-planner-" + todayISO() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Файл сохранён");
});
$("#btnImport").addEventListener("click", () => $("#fileImport").click());
$("#fileImport").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.people || !s.releases || !s.tasks) throw 0;
      state = s;
      if (!state.activeId && state.releases[0])
        state.activeId = state.releases[0].id;
      save();
      render();
      toast("Данные загружены");
    } catch (err) {
      alert("Не удалось прочитать файл");
    }
  };
  r.readAsText(f);
  e.target.value = "";
});

/* ============ версии (автобэкапы) ============ */
$("#btnBackups").addEventListener("click", openBackups);

async function openBackups() {
  openModal("#mBackups");
  const hint = $("#bkHint"),
    list = $("#bklist");
  list.innerHTML = "";
  if (backend !== "server") {
    hint.textContent =
      "Версии доступны только при запуске через start.bat (сервер не найден).";
    return;
  }
  hint.textContent = "Загрузка…";
  try {
    const r = await fetch("/api/backups", { cache: "no-store" });
    const { backups } = await r.json();
    if (!backups.length) {
      hint.textContent =
        "Версий пока нет. Они создаются при изменениях и при каждом запуске.";
      return;
    }
    hint.textContent =
      "Нажмите «Восстановить» — данные файла вернутся к выбранной версии.";
    list.innerHTML = backups
      .map(
        (b, i) => `
    <div class="bkrow">
      <span class="bk-when">${b.at}</span>
      <span class="bk-meta">${i === 0 ? "самый свежий снимок" : "снимок"} · ${(b.size / 1024).toFixed(1)} КБ</span>
      <button data-restore="${b.name}">Восстановить</button>
    </div>`,
      )
      .join("");
    list.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", () => restoreBackup(btn.dataset.restore));
    });
  } catch (e) {
    hint.textContent = "Не удалось получить список версий.";
  }
}

async function restoreBackup(name) {
  if (
    !confirm(
      "Восстановить данные из этой версии? Текущее состояние тоже будет сохранено в backups.",
    )
  )
    return;
  try {
    const r = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    state = j.data;
    if (state.releases.length && !state.activeId)
      state.activeId = state.releases[0].id;
    render();
    toast("Данные восстановлены");
    closeModal("#mBackups");
  } catch (e) {
    alert("Не удалось восстановить: " + e.message);
  }
}
