import { toast } from "../core/dom.js";
import {
  APP_VERSION,
  RELEASES_API,
  RELEASES_URL,
  compareVersions,
} from "../core/version.js";

export function initUpdates() {
  document.querySelector("#appVersion").textContent =
    `Версия приложения ${APP_VERSION}`;
  const button = document.querySelector("#btnUpdates");
  let updateAvailable = false;
  let lastCheck = -Infinity;
  let notifiedVersion = null;
  const interval = 60 * 60 * 1000;
  const notice = document.querySelector("#updateNotice");
  const menu = document.querySelector("#btnMore");
  button.title = `Текущая версия: ${APP_VERSION}`;
  async function checkUpdates(automatic = false) {
    if (button.disabled) return;
    lastCheck = Date.now();
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
        if (!automatic) toast("Опубликованных релизов пока нет.");
        return;
      }
      if (!response.ok) throw new Error("Ошибка GitHub");
      const release = await response.json();
      if (
        release.draft ||
        release.prerelease ||
        typeof release.tag_name !== "string"
      )
        throw new Error("Некорректный релиз");
      const comparison = compareVersions(release.tag_name, APP_VERSION);
      if (comparison > 0) {
        if (notifiedVersion !== release.tag_name || !automatic)
          toast(
            `Доступна версия ${release.tag_name}. Откройте «Меню», чтобы скачать обновление.`,
          );
        notifiedVersion = release.tag_name;
        menu.title = `Меню приложения — доступна версия ${release.tag_name}`;
        menu.setAttribute("aria-label", menu.title);
        notice.hidden = false;
        updateAvailable = true;
      } else {
        if (!automatic)
          toast(
            comparison === 0
              ? `Установлена последняя версия (${APP_VERSION}).`
              : `Установлена версия ${APP_VERSION}, новее опубликованного релиза.`,
          );
      }
    } catch {
      if (!automatic)
        toast("Не удалось проверить обновления. Попробуйте ещё раз.");
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
      button.textContent = updateAvailable
        ? `Доступна версия ${notifiedVersion.replace(/^v/, "")}`
        : "Проверить обновления";
    }
  }
  button.addEventListener("click", () => {
    if (updateAvailable) {
      window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
      return;
    }
    return checkUpdates();
  });
  function checkIfDue() {
    if (
      document.visibilityState === "visible" &&
      Date.now() - lastCheck >= interval
    )
      void checkUpdates(true);
  }
  document.addEventListener("visibilitychange", checkIfDue);
  window.addEventListener("focus", checkIfDue);
  const timer = setInterval(checkIfDue, interval);
  void checkUpdates(true);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", checkIfDue);
    window.removeEventListener("focus", checkIfDue);
  };
}
