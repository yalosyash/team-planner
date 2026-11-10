// Изолированная установка для проверки справочника; рабочие данные не читаются.
// Запуск: node --preserve-symlinks --preserve-symlinks-main docs/product/checks/ui-fixture.cjs
// Завершение: Ctrl+C. Временная копия оставляется для просмотра результата.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const source = path.resolve(__dirname, "../../..");
let child, proxy;
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-docs-ui-"));
  async function copy(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      const a = path.join(from, entry.name),
        b = path.join(to, entry.name);
      if (entry.isDirectory()) await copy(a, b);
      else if (entry.isFile()) await fs.copyFile(a, b);
    }
  }
  for (const name of ["app", "lib"])
    await copy(path.join(source, name), path.join(root, name));
  await fs.copyFile(
    path.join(source, "server.js"),
    path.join(root, "server.js"),
  );
  child = spawn(
    process.execPath,
    [
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      path.join(root, "server.js"),
      "--no-open",
      "--port=0",
    ],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.on("data", (b) => process.stderr.write(b));
  const origin = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("startup timeout")), 20000);
    child.once("error", reject);
    child.stdout.on("data", (b) => {
      out += b;
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
  });
  proxy = http.createServer(async (req, res) => {
    if (req.url.startsWith("/api/calendar")) {
      const year = Number(
        new URL(req.url, "http://localhost").searchParams.get("year"),
      );
      const days = [];
      for (
        let d = new Date(Date.UTC(year, 0, 1));
        d.getUTCFullYear() === year;
        d.setUTCDate(d.getUTCDate() + 1)
      )
        days.push([0, 6].includes(d.getUTCDay()) ? "1" : "0");
      res.setHeader("Content-Type", "text/plain");
      res.end(days.join(""));
      return;
    }
    const upstream = http.request(
      origin + req.url,
      { method: req.method, headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  console.log(
    JSON.stringify({
      root,
      origin,
      ui: `http://127.0.0.1:${proxy.address().port}`,
      calendar: "synthetic Mon-Fri; real server for other routes",
    }),
  );
}
function stop() {
  proxy?.close();
  child?.kill();
}
process.on("SIGINT", () => {
  stop();
  setTimeout(() => process.exit(), 1000);
});
process.on("SIGTERM", () => {
  stop();
  setTimeout(() => process.exit(), 1000);
});
main().catch((e) => {
  console.error(e);
  stop();
  process.exitCode = 1;
});
