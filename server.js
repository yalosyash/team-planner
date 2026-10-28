// Локальный сервер планировщика: отдаёт приложение и хранит данные в data.json
// Запуск: node server.js   (или двойной клик по start.bat)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const MAX_BODY = 5 * 1024 * 1024; // 5 МБ

function writeData(obj) {
  const body = JSON.stringify(obj, null, 2);
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    fs.renameSync(tmp, DATA);
  } catch (e) {
    fs.copyFileSync(tmp, DATA);
    fs.rmSync(tmp, { force: true });
  }
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '').split('?')[0]);

  // --- API: чтение данных ---
  if (url === '/api/data' && req.method === 'GET') {
    let data = null;
    try {
      if (fs.existsSync(DATA)) data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    } catch (e) {
      console.error('Не удалось прочитать data.json:', e.message);
    }
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ data }));
    return;
  }

  // --- API: запись данных ---
  if (url === '/api/data' && req.method === 'POST') {
    let body = '';
    let tooBig = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) { res.writeHead(413); res.end('{"ok":false,"error":"too big"}'); return; }
      try {
        const obj = JSON.parse(body); // не пишем битый JSON
        if (!obj || !Array.isArray(obj.people) || !Array.isArray(obj.releases) || !Array.isArray(obj.tasks)) {
          throw new Error('bad shape');
        }
        writeData(obj);
        res.writeHead(200, { 'Content-Type': TYPES['.json'] });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': TYPES['.json'] });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': TYPES['.json'] });
    res.end(JSON.stringify({ ok: true, dataFile: DATA }));
    return;
  }

  // --- статика ---
  let file = url === '/' ? '/index.html' : url;
  const full = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

function start(port, attempt = 0) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`Порт ${port} занят, пробую ${port + 1}...`);
      start(port + 1, attempt + 1);
    } else {
      console.error('Ошибка сервера:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const addr = `http://127.0.0.1:${port}`;
    console.log('');
    console.log('  Планировщик загрузки команды запущен');
    console.log('  Адрес:  ' + addr);
    console.log('  Данные: ' + DATA);
    console.log('');
    console.log('  Не закрывайте это окно, пока работаете с планировщиком.');
    console.log('  Остановить: Ctrl+C или просто закройте окно.');
    console.log('');
    exec('start "" ' + addr, () => {});
  });
}

start(8787);
