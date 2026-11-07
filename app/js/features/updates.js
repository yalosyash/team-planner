import { toast } from "../core/dom.js";
import { APP_VERSION, RELEASES_API, RELEASES_URL, compareVersions } from "../core/version.js";

export function initUpdates() {
  document.querySelector("#appVersion").textContent = `Версия приложения ${APP_VERSION}`;
  const button = document.querySelector("#btnUpdates");
  let updateAvailable = false;
  button.title = `Текущая версия: ${APP_VERSION}`;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    if (updateAvailable) {
      window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
      return;
    }
    button.disabled = true;
    button.textContent = "Проверка обновлений…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 404) {
        toast("Опубликованных релизов пока нет.");
        return;
      }
      if (!response.ok) throw new Error("Ошибка GitHub");
      const release = await response.json();
      if (release.draft || release.prerelease || typeof release.tag_name !== "string")
        throw new Error("Некорректный релиз");
      const comparison = compareVersions(release.tag_name, APP_VERSION);
      if (comparison > 0) {
        toast(`Доступна версия ${release.tag_name}. Нажмите «Открыть релиз» для скачивания.`);
        updateAvailable = true;
      } else {
        toast(comparison === 0
          ? `Установлена последняя версия (${APP_VERSION}).`
          : `Установлена версия ${APP_VERSION}, новее опубликованного релиза.`);
      }
    } catch {
      toast("Не удалось проверить обновления. Попробуйте ещё раз.");
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
      button.textContent = updateAvailable ? "Открыть релиз" : "Проверить обновления";
    }
  });
}
