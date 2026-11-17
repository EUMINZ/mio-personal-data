import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeSharedProfile, openSharedProfile } from '../examples/shared-profile/fixture.js';
import { readClientCommands } from '../examples/shared-profile/client-commands.js';

const commandsScript = fileURLToPath(new URL('../examples/shared-profile/client-commands.js', import.meta.url));
const mcpServer = fileURLToPath(new URL('../adapters/mcp/server.js', import.meta.url));
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-client-commands-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'profile with space \' $(printf WRONG) `printf WRONG`');
  const manifest = initializeSharedProfile(directory);
  return { parent, directory, manifest };
}

test('generated client commands preserve distinct bindings and safely quote shell metacharacters', (t) => {
  const f = fixture(t);
  const bin = path.join(f.parent, 'bin'); fs.mkdirSync(bin);
  for (const name of ['codex', 'claude']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
  }
  const commands = readClientCommands(f.directory);
  const invoke = (command) => {
    // Fake clients inspect shell argv only: no model, network or real config changes.
    const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const a = invoke(commands.a);
  assert.deepEqual(a.slice(0, 2), ['--sandbox', 'read-only']);
  const setting = (key) => a.find((arg) => arg.startsWith(key + '=')).slice(key.length + 1);
  assert.equal(JSON.parse(setting('mcp_servers.mio_trial_a.command')), process.execPath);
  assert.deepEqual(JSON.parse(setting('mcp_servers.mio_trial_a.args')), [mcpServer, '--config', f.manifest.assistants.a.configPath]);
  const b = invoke(commands.b);
  assert.deepEqual(b.slice(0, 2), ['--strict-mcp-config', '--mcp-config']);
  const config = JSON.parse(b[2]);
  assert.deepEqual(Object.keys(config.mcpServers), ['mio_trial_b']);
  assert.equal(config.mcpServers.mio_trial_b.command, process.execPath);
  assert.deepEqual(config.mcpServers.mio_trial_b.args, [mcpServer, '--config', f.manifest.assistants.b.configPath]);
});

test('command reprint validates an existing fixture without renewing grants or changing profile records', (t) => {
  const f = fixture(t);
  const local = openSharedProfile(f.directory);
  try {
    const { repository } = local.states.a;
    const before = repository.listGrantsForPerson(f.manifest.personId);
    const audit = repository.listAuditEventsForPerson(f.manifest.personId);
    const result = spawnSync(process.execPath, [commandsScript, f.directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mio_trial_a/);
    assert.match(result.stdout, /mio_trial_b/);
    assert.doesNotMatch(result.stdout, /#token=|alex\./);
    assert.deepEqual(repository.listGrantsForPerson(f.manifest.personId), before);
    assert.deepEqual(repository.listAuditEventsForPerson(f.manifest.personId), audit);
  } finally { local.close(); }
  const absent = path.join(f.parent, 'absent');
  const failed = spawnSync(process.execPath, [commandsScript, absent], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(fs.existsSync(absent), false);
});
