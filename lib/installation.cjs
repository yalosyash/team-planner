// Подготовка установки до запуска HTTP и фоновых писателей.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createFileStore } = require("./file-store.cjs");

function acquireInstance(root) {
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const file = path.join(runtime, "instance.lock");
  const token = randomUUID();
  let handle;
  try {
    handle = fs.openSync(file, "wx");
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error(
        `Установка занята или осталась блокировка: ${file}. Закройте все экземпляры; для оставшейся блокировки проверьте PID перед удалением.`,
      );
    throw e;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, token }));
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  let released = false;
  const release = () => {
    if (released) return;
    try {
      if (JSON.parse(fs.readFileSync(file, "utf8")).token === token)
        fs.unlinkSync(file);
      released = true;
    } catch (e) {
      if (e.code === "ENOENT") released = true;
    }
  };
  return release;
}
async function prepareInstallation(
  root,
  { store = createFileStore(root) } = {},
) {
  const release = acquireInstance(root);
  try {
    const result = await (await store).migrate();
    const previousLog = path.join(root, "data/server.log");
    const nextLog = path.join(root, "runtime/server.log");
    try {
      const original = await fsp.readFile(previousLog);
      try {
        await fsp.copyFile(previousLog, nextLog, fs.constants.COPYFILE_EXCL);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      if (
        (await fsp.readFile(nextLog)).equals(original) &&
        (await fsp.readFile(previousLog)).equals(original)
      )
        await fsp.unlink(previousLog);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const relative of ["data/server.pid", "runtime/server.pid"]) {
      const file = path.join(root, relative);
      try {
        const raw = await fsp.readFile(file, "utf8");
        const pid = Number(raw.trim());
        if (!Number.isSafeInteger(pid) || pid <= 0)
          throw new Error(`Неверный PID: ${file}`);
        let dead = false;
        try {
          process.kill(pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") dead = true;
        }
        if (!dead)
          throw new Error(`Процесс ${pid} ещё работает; запуск отменён`);
        if ((await fsp.readFile(file, "utf8")) === raw) await fsp.unlink(file);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    // Удаляем launcher только при наличии точной проверенной копии этой попытки.
    if (result.backup) {
      const old = path.join(root, "data/launcher.json");
      try {
        const bytes = await fsp.readFile(old);
        if (
          (
            await fsp.readFile(path.join(result.backup, "launcher.json"))
          ).equals(bytes)
        )
          await fsp.unlink(old);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    process.once("exit", release);
    return { ...result, release };
  } catch (e) {
    release();
    throw e;
  }
}
module.exports = { prepareInstallation };
