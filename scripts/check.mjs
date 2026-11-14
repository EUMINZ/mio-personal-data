import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
for (const dir of ['mio-core', 'examples', 'scripts']) {
  for (const file of walk(dir).filter(file => /\.m?js$/.test(file))) run(['--check', file]);
}
run(['--test', ...walk('mio-core/tests').filter(file => file.endsWith('.test.js'))]);
run(['examples/two-assistants.js']);
