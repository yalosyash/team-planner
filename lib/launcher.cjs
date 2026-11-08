// VBS передаёт только ответ о ярлыке, JSON пишет общий файловый адаптер.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createFileStore } = require("./file-store.cjs");
const { prepareInstallation } = require("./installation.cjs");

async function launcher(root, command, args = []) {
  const store = await createFileStore(root);
  let completed = false;
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(root, "settings/system.json"), "utf8"),
    );
    completed = raw?.migrations?.splitStorage === 1;
    if (completed) {
      try {
        await fs.access(path.join(root, "settings/preferences.json"));
      } catch (e) {
        if (e.code === "ENOENT") completed = false;
        else throw e;
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let installation;
  try {
    if (!completed) installation = await prepareInstallation(root, { store });
    // Не создаём дефолты перед переносом; существующую завершённую установку
    // можно читать и при работающем сервере, используя его общие блокировки.
    await store.read("data");
    await store.read("preferences");
    const current = await store.read("system");
    if (command === "status")
      return current.data.launcher.desktopShortcutAsked ? "asked" : "ask";
    if (
      command !== "answer" ||
      args.length !== 1 ||
      !["true", "false"].includes(args[0])
    )
      throw new Error("Usage: launcher.cjs status | answer true|false");
    await store.updateLauncher({
      desktopShortcutAsked: true,
      desktopShortcutCreated: args[0] === "true",
    });
    return "ok";
  } finally {
    installation?.release();
  }
}
module.exports = { launcher };
if (require.main === module) {
  launcher(
    path.resolve(__dirname, ".."),
    process.argv[2],
    process.argv.slice(3),
  )
    .then((text) => console.log(text))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
