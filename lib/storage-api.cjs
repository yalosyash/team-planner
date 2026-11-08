const { createFileStore } = require("./file-store.cjs");
const MAX_BODY = 5 * 1024 * 1024;

// Создание обработчика не читает и не меняет файлы. Штатный сервер
// подключает его после подготовки установки.
function createStorageApi(root, options = {}) {
  let store;
  const getStore = () =>
    (store ||= options.store || createFileStore(root, options));
  const routes = {
    "/api/data": "data",
    "/api/preferences": "preferences",
    "/api/system": "system",
  };
  const reply = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  return async function storageApi(req, res) {
    const pathname = (req.url || "").split("?")[0];
    if (!Object.hasOwn(routes, pathname)) return false;
    const kind = routes[pathname];
    try {
      if (!["GET", "POST"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST");
        reply(res, 405, { ok: false, error: "Метод не поддерживается" });
        return true;
      }
      if (req.method === "GET") {
        reply(res, 200, await (await getStore()).read(kind));
        return true;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        // Дочитываем запрос, чтобы гарантированно вернуть HTTP 413.
        if (size <= MAX_BODY) chunks.push(chunk);
      }
      if (size > MAX_BODY) {
        reply(res, 413, { ok: false, error: "Слишком большой документ" });
        return true;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reply(res, 400, { ok: false, error: "Неверный JSON" });
        return true;
      }
      const value = kind === "system" ? body?.patch : body?.data;
      const currentStore = await getStore();
      const result =
        kind === "system"
          ? await currentStore.patch(value, body?.baseRevision)
          : await currentStore.write(kind, value, body?.baseRevision);
      reply(res, 200, { ok: true, ...result });
    } catch (error) {
      reply(res, error.status || 500, {
        ok: false,
        error: error.message,
        code: error.code || "STORAGE_IO",
      });
    }
    return true;
  };
}
module.exports = { createStorageApi };
