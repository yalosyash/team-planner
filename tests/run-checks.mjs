import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const group = process.argv[2];
const suites = {
  node: ['server-isolation', 'storage', 'calendar', 'calendar-auto',
    'release-transfer', 'task-labels', 'updates', 'release-backup',
    'people-draft', 'storage-migration', 'split-storage'],
  windows: ['installation'],
};
if (group !== 'syntax' && !suites[group]) throw new Error(`Unknown suite: ${group}`);
if (group === 'windows' && process.platform !== 'win32') {
  throw new Error('Windows suite requires Windows; skipping is not success');
}
await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
const log = path.join(root, 'test-results', `${group}.log`);
await fs.writeFile(log, '');
async function run(args) {
  const label = `node ${args.join(' ')}`;
  console.log(label);
  const child = spawn(process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', ...args],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [label + '\n'];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    process.stdout.write(data);
    chunks.push(data.toString());
  });
  const timer = setTimeout(() => child.kill(), 120_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearTimeout(timer);
    await fs.appendFile(log, chunks.join(''));
  }
  if (code !== 0) throw new Error(`${label} failed (exit ${code})`);
}
async function sources(directory) {
  const files = [];
  for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await sources(name));
    else if (/\.(js|cjs|mjs)$/.test(name)) files.push(name);
  }
  return files.sort();
}
if (group === 'syntax') {
  const files = ['server.js', 'playwright.config.cjs', 'vitest.config.mjs',
    ...await sources('app/js'), ...await sources('lib'), ...await sources('tests')];
  for (const file of files) await run(['--check', file]);
} else {
  for (const name of suites[group]) await run([
    ...(name === 'people-draft' ? ['--experimental-vm-modules'] : []),
    `tests/${name}.mjs`,
  ]);
}
console.log(`Suite ${group} passed`);
