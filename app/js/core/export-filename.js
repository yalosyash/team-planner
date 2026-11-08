// Имя описывает содержимое файла; дата — местная, в формате ДД-ММ-ГГ.
export function exportFilename(
  data,
  { purpose = "all", now = new Date() } = {},
) {
  const safe = (value) =>
    String(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 80)
      .replace(/[. ]+$/g, "") || "release";
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${String(now.getFullYear()).slice(-2)}`;
  const single = data.format === "team-planner-release";
  const scope = single ? `release-${safe(data.release.number)}` : purpose;
  const releases = single ? "" : `_releases-${data.releases.length}`;
  return `${scope}${releases}_tasks-${data.tasks.length}_${stamp}.json`;
}
