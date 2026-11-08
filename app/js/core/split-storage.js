// Раздельное хранение для штатной загрузки и сохранения state.
import {
  StorageError,
  STORAGE_KEYS,
  storageKind,
  defaults,
  validateDocument,
  patchSystem,
  canonicalJson,
  copyDocument,
} from "./storage-schema.js";
import { prepareStorageMigration } from "./storage-migration.js";

export function createBrowserStore({
  storage = globalThis.localStorage,
  locks = globalThis.navigator?.locks,
  crypto = globalThis.crypto,
  events = globalThis.window,
} = {}) {
  const writable = !!locks?.request && !!crypto?.subtle;
  async function revision(data) {
    if (!crypto?.subtle) return null; // чтение/экспорт доступны и в старом браузере
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalJson(data)),
    );
    return Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
  }
  const packet = async (data) => ({
    data,
    revision: await revision(data),
    readOnly: !writable,
  });
  function locked(kind, action) {
    storageKind(kind);
    if (!writable)
      throw new StorageError(
        "Без Web Locks и Web Crypto доступно только чтение и экспорт",
        "READ_ONLY",
        503,
      );
    return locks.request(
      "team-planner:" + STORAGE_KEYS[kind],
      { mode: "exclusive" },
      action,
    );
  }
  function load(kind, create) {
    const raw = storage.getItem(STORAGE_KEYS[storageKind(kind)]);
    if (raw === null) {
      if (kind === "data") return null;
      const data = defaults(kind);
      if (create) storage.setItem(STORAGE_KEYS[kind], JSON.stringify(data));
      return data;
    }
    try {
      return validateDocument(kind, JSON.parse(raw));
    } catch (error) {
      throw new StorageError(
        `Не удалось прочитать ${STORAGE_KEYS[kind]}: ${error.message}`,
        error.code === "UNSUPPORTED_VERSION" ? error.code : "CORRUPT_DOCUMENT",
        500,
      );
    }
  }
  async function read(kind) {
    storageKind(kind);
    return writable
      ? locked(kind, () => packet(load(kind, true)))
      : packet(load(kind, false));
  }
  async function write(kind, data, baseRevision) {
    storageKind(kind);
    if (kind === "system")
      throw new StorageError("system изменяется только через patch");
    const next = validateDocument(kind, copyDocument(data));
    return locked(kind, async () => {
      const current = load(kind, false);
      if (baseRevision !== (await revision(current)))
        throw new StorageError(
          "Документ изменился в другой вкладке",
          "CONFLICT",
          409,
        );
      // setItem атомарен для одного ключа: quota error оставляет прежнее значение.
      storage.setItem(STORAGE_KEYS[kind], JSON.stringify(next));
      return packet(next);
    });
  }
  async function patch(patch, baseRevision) {
    const nextPatch = copyDocument(patch);
    return locked("system", async () => {
      const current = load("system", false);
      if (baseRevision !== (await revision(current)))
        throw new StorageError(
          "Системные данные изменились в другой вкладке",
          "CONFLICT",
          409,
        );
      const next = patchSystem(current, nextPatch);
      storage.setItem(STORAGE_KEYS.system, JSON.stringify(next));
      return packet(next);
    });
  }
  function subscribe(listener) {
    const handler = (event) => {
      if (event.storageArea !== storage) return;
      if (event.key === null) {
        for (const kind of Object.keys(STORAGE_KEYS)) listener(kind);
        return;
      }
      const kind = Object.keys(STORAGE_KEYS).find(
        (k) => STORAGE_KEYS[k] === event.key,
      );
      if (kind) listener(kind);
    };
    events?.addEventListener("storage", handler);
    return () => events?.removeEventListener("storage", handler);
  }
  async function migrate() {
    // Тот же порядок, что у файлового адаптера; обычные записи получают
    // одну из этих блокировок и не видят промежуточное состояние перехода.
    if (!writable)
      throw new StorageError(
        "Миграция требует Web Locks и Web Crypto",
        "READ_ONLY",
        503,
      );
    return locks.request("team-planner:migration", { mode: "exclusive" }, () =>
      locked("data", () =>
        locked("preferences", () =>
          locked("system", async () => {
            const legacyKey = "team-planner-v1";
            const themeKey = "team-planner-theme";
            const backupKey = "team-planner-migration-v1";
            async function cleanLegacy() {
              const raw = storage.getItem(backupKey);
              if (raw === null) return;
              const saved = JSON.parse(raw);
              if (
                saved.version !== 1 ||
                saved.revision !== (await revision(saved.sources))
              )
                throw new StorageError(
                  "Повреждена миграционная копия",
                  "MIGRATION_BACKUP",
                  500,
                );
              const legacy = storage.getItem(legacyKey);
              // Не удалять данные старой вкладки, изменившиеся после копии.
              if (legacy !== null && saved.sources[legacyKey] === legacy)
                storage.removeItem(legacyKey);
            }
            const sources = Object.fromEntries(
              [...Object.values(STORAGE_KEYS), legacyKey, themeKey].map(
                (key) => [key, storage.getItem(key)],
              ),
            );
            const parse = (key) => {
              try {
                return sources[key] === null ? null : JSON.parse(sources[key]);
              } catch {
                throw new StorageError(
                  `Повреждён исходник: ${key}`,
                  "CORRUPT_DOCUMENT",
                  500,
                );
              }
            };
            const current = parse(STORAGE_KEYS.data);
            const preferences = parse(STORAGE_KEYS.preferences);
            const system = parse(STORAGE_KEYS.system);
            if (
              system?.migrations?.splitStorage === 1 &&
              preferences !== null
            ) {
              if (current !== null) validateDocument("data", current);
              validateDocument("preferences", preferences);
              validateDocument("system", system);
              await cleanLegacy();
              return { migrated: false, backup: null };
            }
            const next = prepareStorageMigration({
              data: current ?? parse(legacyKey),
              preferences,
              system,
              theme: sources[themeKey],
            });
            const existing = storage.getItem(backupKey);
            if (existing === null) {
              const backup = {
                version: 1,
                sources,
                revision: await revision(sources),
              };
              const raw = JSON.stringify(backup);
              storage.setItem(backupKey, raw);
              if (storage.getItem(backupKey) !== raw)
                throw new StorageError(
                  "Не удалось проверить миграционную копию",
                  "MIGRATION_BACKUP",
                  500,
                );
            } else {
              let saved;
              try {
                saved = JSON.parse(existing);
              } catch {}
              if (
                saved?.version !== 1 ||
                !saved.sources ||
                saved.revision !== (await revision(saved.sources))
              )
                throw new StorageError(
                  "Повреждена миграционная копия",
                  "MIGRATION_BACKUP",
                  500,
                );
            }
            // Старые вкладки не используют Web Locks. Отказываемся затирать
            // изменение, произошедшее за время подготовки и проверки копии.
            for (const [key, raw] of Object.entries(sources))
              if (storage.getItem(key) !== raw)
                throw new StorageError(
                  `Исходник изменился: ${key}`,
                  "CONFLICT",
                  409,
                );
            function save(kind, data) {
              const raw = JSON.stringify(validateDocument(kind, data));
              storage.setItem(STORAGE_KEYS[kind], raw);
              if (storage.getItem(STORAGE_KEYS[kind]) !== raw)
                throw new StorageError(
                  `Не удалось проверить запись: ${kind}`,
                  "MIGRATION_VERIFY",
                  500,
                );
            }
            save("preferences", next.preferences);
            save("system", { ...next.system, migrations: { splitStorage: 0 } });
            if (next.data !== null) save("data", next.data);
            save("system", { ...next.system, migrations: { splitStorage: 1 } });
            await cleanLegacy();
            return { migrated: true, backup: backupKey };
          }),
        ),
      ),
    );
  }
  return { read, write, patch, subscribe, migrate };
}

// HTTP-ошибки передаются вызывающему коду. Автоматического перехода
// на localStorage после неудачной записи здесь нет.
export function createHttpStore({ fetch = globalThis.fetch } = {}) {
  async function request(kind, body) {
    storageKind(kind);
    const response = await fetch(
      "/api/" + kind,
      body === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: true,
          },
    );
    const result = await response.json();
    if (!response.ok)
      throw new StorageError(
        result.error || "Ошибка хранилища",
        result.code || "STORAGE_HTTP",
        response.status,
      );
    if (!(kind === "data" && result.data === null))
      validateDocument(kind, result.data);
    if (!/^[a-f0-9]{64}$/.test(result.revision))
      throw new StorageError(
        "Сервер вернул неверную ревизию",
        "INVALID_RESPONSE",
        502,
      );
    return result;
  }
  return {
    read: (kind) => request(kind),
    write: (kind, data, baseRevision) => {
      storageKind(kind);
      if (kind === "system")
        throw new StorageError("system изменяется только через patch");
      return request(kind, {
        data: validateDocument(kind, copyDocument(data)),
        baseRevision,
      });
    },
    patch: (patch, baseRevision) =>
      request("system", { patch: copyDocument(patch), baseRevision }),
  };
}
