// Вызывается только file-store под блокировками всех трёх документов.
// Подключён через prepareInstallation до запуска HTTP и фоновых писателей.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHash, randomUUID } = require("node:crypto");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const moduleUrl = (name) =>
  pathToFileURL(path.join(__dirname, "../app/js/core/", name)).href;

async function migrateFiles({ root, io, atomic, file }) {
  const { prepareStorageMigration } = await import(
    moduleUrl("storage-migration.js")
  );
  const { validateDocument, canonicalJson, StorageError } = await import(
    moduleUrl("storage-schema.js")
  );
  const read = async (relative) => {
    try {
      return await io.readFile(path.join(root, relative));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  // Не считать неизвестный процесс старым сервером и не завершать его.
  for (const relative of ["data/server.pid", "runtime/server.pid"]) {
    const raw = await read(relative);
    if (raw === null) continue;
    const value = raw.toString("utf8").trim();
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new StorageError(
        `Не удалось проверить PID: ${relative}`,
        "MIGRATION_PID",
        503,
      );
    let alive = true;
    try {
      process.kill(Number(value), 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive)
      throw new StorageError(
        `Перед миграцией остановите сервер: ${relative}, PID ${value}`,
        "MIGRATION_RUNNING",
        503,
      );
  }
  const paths = {
    data: "data/data.json",
    preferences: "settings/preferences.json",
    system: "settings/system.json",
    launcher: "data/launcher.json",
  };
  const originals = {};
  const parsed = {};
  for (const [kind, relative] of Object.entries(paths)) {
    originals[kind] = await read(relative);
    try {
      parsed[kind] =
        originals[kind] === null
          ? null
          : JSON.parse(originals[kind].toString("utf8"));
    } catch {
      throw new StorageError(
        `Повреждён исходник: ${relative}`,
        "CORRUPT_DOCUMENT",
        500,
      );
    }
  }
  const next = prepareStorageMigration(parsed);
  // Маркер сам по себе не достаточен: все три документа должны существовать
  // и проходить строгую проверку, включая отсутствие legacy-полей в data.
  if (
    parsed.system?.migrations?.splitStorage === 1 &&
    originals.preferences !== null &&
    originals.system !== null &&
    (parsed.data === null || parsed.data.version === 4)
  ) {
    validateDocument("preferences", parsed.preferences);
    validateDocument("system", parsed.system);
    if (parsed.data !== null) validateDocument("data", parsed.data);
    return { migrated: false, backup: null };
  }
  const backup = path.join(root, "settings/migration-backups", randomUUID());
  await io.mkdir(backup, { recursive: true });
  async function durable(target, bytes) {
    const handle = await io.open(target, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!(await io.readFile(target)).equals(Buffer.from(bytes)))
      throw new StorageError(
        `Не удалось проверить копию: ${target}`,
        "MIGRATION_BACKUP",
        500,
      );
  }
  try {
    const sources = [];
    for (const [kind, relative] of Object.entries(paths)) {
      const bytes = originals[kind];
      const name = kind + ".json";
      if (bytes !== null) await durable(path.join(backup, name), bytes);
      sources.push({
        path: relative,
        present: bytes !== null,
        copy: bytes === null ? null : name,
        sha256: bytes === null ? null : sha(bytes),
      });
    }
    await durable(
      path.join(backup, "manifest.json"),
      JSON.stringify({ version: 1, sources }, null, 2) + "\n",
    );
    // Проверка источников непосредственно перед записью: старый внешний
    // писатель не соблюдает наши блокировки. Изменённые байты не затираем.
    async function unchanged(kind) {
      const current = await read(paths[kind]);
      const original = originals[kind];
      if (
        (current === null) !== (original === null) ||
        (current !== null && !current.equals(original))
      )
        throw new StorageError(
          `Исходник изменился: ${paths[kind]}`,
          "CONFLICT",
          409,
        );
    }
    for (const kind of Object.keys(paths)) await unchanged(kind);
    async function save(kind, document) {
      await atomic(kind, document);
      const saved = JSON.parse(await io.readFile(file(kind), "utf8"));
      validateDocument(kind, saved);
      if (canonicalJson(saved) !== canonicalJson(document))
        throw new StorageError(
          `Не удалось проверить запись: ${file(kind)}`,
          "MIGRATION_VERIFY",
          500,
        );
    }
    await save("preferences", next.preferences);
    await save("system", { ...next.system, migrations: { splitStorage: 0 } });
    // Проверить data ещё раз после записи настроек.
    await unchanged("data");
    if (next.data !== null) await save("data", next.data);
    await save("system", { ...next.system, migrations: { splitStorage: 1 } });
    // Перенос runtime и уборку проверенных исходников выполняет installation.
    return { migrated: true, backup };
  } catch (error) {
    error.message += `; исходники миграции: ${backup}`;
    error.backup = backup;
    throw error;
  }
}
async function prepareBoard(data) {
  return (await import(moduleUrl("storage-migration.js"))).workingData(data);
}
module.exports = { migrateFiles, prepareBoard };
