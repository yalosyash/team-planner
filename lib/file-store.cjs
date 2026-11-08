// Единый писатель JSON для сервера и CLI launcher.
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHash, randomUUID } = require("node:crypto");

const schema = import(
  pathToFileURL(path.join(__dirname, "../app/js/core/storage-schema.js")).href
);
const paths = Object.freeze({
  data: "data/data.json",
  preferences: "settings/preferences.json",
  system: "settings/system.json",
});

async function createFileStore(root, options = {}) {
  const {
    StorageError,
    storageKind,
    defaults,
    validateDocument,
    patchSystem,
    canonicalJson,
    copyDocument,
  } = await schema;
  const io = options.io || fs;
  const lockTimeout = options.lockTimeout ?? 2000;
  const runtime = path.join(path.resolve(root), "runtime");
  const file = (kind) =>
    path.join(path.resolve(root), paths[storageKind(kind)]);
  const revision = (data) =>
    createHash("sha256").update(canonicalJson(data)).digest("hex");
  const packet = (data) => ({ data, revision: revision(data) });

  async function withLock(kind, action) {
    if (kind !== "migration") storageKind(kind);
    await io.mkdir(runtime, { recursive: true });
    const lock = path.join(runtime, kind + ".lock");
    const token = randomUUID();
    const started = Date.now();
    let handle;
    while (!handle) {
      try {
        handle = await io.open(lock, "wx");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() - started >= lockTimeout) {
          // Даже мёртвую/неполную блокировку не удаляем автоматически:
          // два конкурента не должны удалить блокировку нового владельца.
          let owner = "неизвестен";
          try {
            const metadata = JSON.parse(await io.readFile(lock, "utf8"));
            if (Number.isInteger(metadata.pid) && metadata.pid > 0) {
              let alive = true;
              try {
                process.kill(metadata.pid, 0);
              } catch (e) {
                if (e.code === "ESRCH") alive = false;
              }
              owner = `${metadata.pid} (${alive ? "жив или недоступен" : "завершён"})`;
            }
          } catch {}
          throw new StorageError(
            `Хранилище занято: ${lock}; PID ${owner}`,
            "STORAGE_LOCKED",
            503,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token }),
        "utf8",
      );
      await handle.sync();
      return await action();
    } finally {
      await handle.close();
      // Проверяем владельца перед освобождением; чужой lock не трогаем.
      let owner;
      try {
        owner = JSON.parse(await io.readFile(lock, "utf8"));
      } catch {}
      if (owner?.token === token) await io.unlink(lock);
    }
  }

  async function atomic(kind, data) {
    const target = file(kind);
    await io.mkdir(path.dirname(target), { recursive: true });
    const temporary = target + "." + randomUUID() + ".tmp";
    let handle;
    let created = false;
    try {
      handle = await io.open(temporary, "wx");
      created = true;
      await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      // Никакого copy поверх живого JSON при ошибке rename.
      await io.rename(temporary, target);
    } finally {
      if (handle) await handle.close();
      if (created)
        await io.unlink(temporary).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
    }
  }

  async function load(kind) {
    let raw;
    try {
      raw = await io.readFile(file(kind), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (kind === "data") return null;
      const data = defaults(kind);
      await atomic(kind, data);
      return data;
    }
    try {
      return validateDocument(kind, JSON.parse(raw));
    } catch (e) {
      throw new StorageError(
        `Не удалось прочитать ${file(kind)}: ${e.message}`,
        e.code === "UNSUPPORTED_VERSION" ? e.code : "CORRUPT_DOCUMENT",
        500,
      );
    }
  }

  async function read(kind) {
    return withLock(kind, async () => packet(await load(kind)));
  }
  async function write(kind, data, baseRevision, beforeCommit) {
    storageKind(kind);
    if (kind === "system")
      throw new StorageError("system изменяется только через patch");
    // Отделяем аргумент от вызывающего кода до первого await.
    const next = validateDocument(kind, copyDocument(data));
    return withLock(kind, async () => {
      const current = await load(kind);
      if (baseRevision !== revision(current))
        throw new StorageError(
          "Документ изменился. Перечитайте его перед сохранением.",
          "CONFLICT",
          409,
        );
      if (beforeCommit) await beforeCommit();
      if (options.beforeWrite) await options.beforeWrite(kind, current);
      await atomic(kind, next);
      return packet(next);
    });
  }
  async function patch(patch, baseRevision, owner = "browser") {
    const nextPatch = copyDocument(patch);
    return withLock("system", async () => {
      const current = await load("system");
      if (baseRevision !== revision(current))
        throw new StorageError("Системные данные изменились", "CONFLICT", 409);
      const next = patchSystem(current, nextPatch, owner);
      await atomic("system", next);
      return packet(next);
    });
  }
  // CLI не делает read/modify/write снаружи блокировки, меняет только launcher.
  async function updateLauncher(launcher) {
    const nextLauncher = copyDocument(launcher);
    return withLock("system", async () => {
      const current = await load("system");
      const next = patchSystem(current, { launcher: nextLauncher }, "launcher");
      await atomic("system", next);
      return packet(next);
    });
  }
  // Все писатели этих документов ожидают завершения миграции. Порядок
  // блокировок фиксирован; callback не вызывает публичные read/write.
  async function migrate() {
    const { migrateFiles } = require("./file-migration.cjs");
    return withLock("migration", () =>
      withLock("data", () =>
        withLock("preferences", () =>
          withLock("system", () =>
            migrateFiles({ root: path.resolve(root), io, atomic, file }),
          ),
        ),
      ),
    );
  }
  return { read, write, patch, updateLauncher, migrate };
}

module.exports = { createFileStore };
