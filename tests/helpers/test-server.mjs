import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createPlannerServer } = require("../../server.js");

// Own the entire temporary installation, including settings and runtime.
export async function startTestServer() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-qa-"));
  let application;
  async function stop() {
    await application?.close();
  }
  async function restart() {
    await stop();
    application = createPlannerServer({ root });
    fixture.origin = await application.listen();
  }
  async function dispose() {
    try {
      await stop();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  const fixture = { root, origin: null, restart, stop, dispose };
  try {
    await restart();
    return fixture;
  } catch (error) {
    await dispose();
    throw error;
  }
}
