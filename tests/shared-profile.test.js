import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { initializeSharedProfile, openSharedProfile, SHARED_PROFILE_FIELDS as F,
  SHARED_PROFILE_VALUES as V } from '../examples/shared-profile/fixture.js';
import { listReviews, approveReview, shareClaim, revoke } from '../adapters/mcp/admin.js';

const serverPath = fileURLToPath(new URL('../adapters/mcp/server.js', import.meta.url));
const initPath = fileURLToPath(new URL('../examples/shared-profile/init.js', import.meta.url));
const read = (client, fields) => client.callTool({ name: 'mio_context', arguments: { fields } });
const propose = (client, value = V.nextEmail) => client.callTool({ name: 'mio_propose_update',
  arguments: { field: F.email, value, rationale: 'Fictional shared-profile change requested for this demo.' } });
function data(response) {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return response.structuredContent ?? JSON.parse(response.content[0].text);
}
function context(response, fields, unavailable = []) {
  const value = data(response);
  assert.deepEqual(value.fields, fields);
  assert.deepEqual(value.unavailable, unavailable);
  assert.equal(new Date(value.checkedAt).toISOString(), value.checkedAt);
  assert.doesNotMatch(JSON.stringify(response), /FICTIONAL_PRIVATE|grantId|requesterId|personId|\.sqlite/);
}
function denied(response) {
  assert.equal(response.isError, true);
  assert.doesNotMatch(JSON.stringify(response), /alex\.|Alex|FICTIONAL_PRIVATE|Example Lane|grantId|personId/);
}

function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mio-shared-test-')));
  const initialized = initializeSharedProfile(path.join(parent, 'demo'));
  const connections = [];
  const handles = [];
  const open = () => { const state = openSharedProfile(initialized.directory); handles.push(state); return state; };
  t.after(async () => {
    try {
      for (const connection of connections) await connection.close();
      for (const handle of handles) handle.close();
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
  return { parent, ...initialized, open, async connect(id, extraConfigPath) {
    const client = new Client({ name: `shared-profile-test-${id}`, version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [serverPath, '--config', extraConfigPath ?? initialized.assistants[id].configPath], stderr: 'pipe' });
    let stderr = ''; let closed = false;
    transport.stderr.on('data', (chunk) => { stderr += chunk; });
    const close = async () => {
      if (closed) return;
      closed = true;
      await client.close();
      assert.doesNotMatch(stderr, /FICTIONAL_PRIVATE/);
    };
    connections.push({ close });
    await client.connect(transport);
    return { client, close };
  } };
}

test('shared fixture creates one private database, distinct scoped grants and an overwrite-safe CLI', (t) => {
  const f = fixture(t); const { states } = f.open();
  assert.equal(states.a.config.databasePath, states.b.config.databasePath);
  assert.equal(states.a.config.personId, states.b.config.personId);
  assert.notEqual(states.a.config.requesterId, states.b.config.requesterId);
  assert.notEqual(states.a.config.grantId, states.b.config.grantId);
  for (const id of ['a', 'b']) {
    const grant = states[id].repository.listGrantsForPerson(f.personId).find((g) => g.id === states[id].config.grantId);
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.grantedAt), 24 * 3_600_000);
    assert.deepEqual(grant.scope.allowedFields, f.assistants[id].fields);
  }
  const before = fs.readFileSync(f.manifestPath, 'utf8');
  assert.throws(() => initializeSharedProfile(f.directory), /EEXIST/);
  assert.equal(fs.readFileSync(f.manifestPath, 'utf8'), before);
  assert.throws(() => initializeSharedProfile('relative-demo'), /absolute/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
    for (const file of [f.databasePath, f.manifestPath, f.assistants.a.configPath, f.assistants.b.configPath]) {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  }
  const cliDirectory = path.join(f.parent, 'from-cli');
  const run = spawnSync(process.execPath, [initPath, cliDirectory], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const printed = JSON.parse(run.stdout);
  assert.equal(printed.directory, cliDirectory);
  assert.equal(printed.assistants.b.configPath, path.join(cliDirectory, 'assistant-b.json'));
  assert.equal(printed.fictional, true);
  const retry = spawnSync(process.execPath, [initPath, cliDirectory], { encoding: 'utf8' });
  assert.equal(retry.status, 1);
});

test('two live MCP processes observe proposal, approval, explicit sharing and independent revocation', async (t) => {
  const f = fixture(t); const { states } = f.open();
  const a = await f.connect('a'); const b = await f.connect('b');
  for (const connection of [a, b]) {
    assert.deepEqual((await connection.client.listTools()).tools.map((tool) => tool.name).sort(),
      ['mio_context', 'mio_propose_update']);
  }
  context(await read(a.client, [F.firstName, F.email, F.address, F.passport]),
    { [F.firstName]: V.firstName, [F.email]: V.email }, [F.address, F.passport]);
  context(await read(b.client, [F.firstName, F.address, F.email, F.passport]),
    { [F.firstName]: V.firstName, [F.address]: V.address }, [F.email, F.passport]);

  const pending = data(await propose(a.client));
  assert.equal(pending.status, 'pending');
  context(await read(a.client, [F.email]), { [F.email]: V.email });
  assert.deepEqual(listReviews(states.b), []);
  const [review] = listReviews(states.a);
  assert.equal(review.reviewItemId, pending.reviewItemId);
  assert.equal(review.currentValue, V.email);
  assert.equal(review.suggestedValue, V.nextEmail);
  assert.throws(() => approveReview(states.b, { ...review, expectedValue: V.nextEmail, confirmed: true }), /does not match/);
  const approved = approveReview(states.a, { ...review, expectedValue: V.nextEmail, confirmed: true });
  assert.equal(approved.shared, false);
  context(await read(a.client, [F.firstName, F.email]), { [F.firstName]: V.firstName }, [F.email]);
  context(await read(b.client, [F.firstName, F.address, F.email]),
    { [F.firstName]: V.firstName, [F.address]: V.address }, [F.email]);
  assert.throws(() => shareClaim(states.b, { field: F.email, claimId: approved.claimId, confirmed: true }), /allowed grant/);
  shareClaim(states.a, { field: F.email, claimId: approved.claimId, confirmed: true });
  context(await read(a.client, [F.email]), { [F.email]: V.nextEmail });

  // Restart both servers: they still share the durable state, not independent --demo DBs.
  await a.close(); await b.close();
  const restartedA = await f.connect('a'); const restartedB = await f.connect('b');
  context(await read(restartedA.client, [F.email]), { [F.email]: V.nextEmail });
  context(await read(restartedB.client, [F.address]), { [F.address]: V.address });
  revoke(states.a, true);
  denied(await read(restartedA.client, [F.firstName, F.email]));
  denied(await propose(restartedA.client));
  context(await read(restartedB.client, [F.firstName, F.address]),
    { [F.firstName]: V.firstName, [F.address]: V.address });
  const reopened = f.open();
  assert.equal(reopened.states.a.repository.listGrantsForPerson(f.personId)
    .find((grant) => grant.id === reopened.states.a.config.grantId).status, 'revoked');
});

test('shared workflow rejects stale competing reviews and caller-controlled cross-assistant bindings', async (t) => {
  const f = fixture(t); const { states } = f.open();
  const a = await f.connect('a'); const b = await f.connect('b');
  const first = data(await propose(a.client, 'alex.one@example.invalid'));
  const second = data(await propose(a.client, 'alex.two@example.invalid'));
  const reviews = listReviews(states.a);
  const firstReview = reviews.find((item) => item.reviewItemId === first.reviewItemId);
  const secondReview = reviews.find((item) => item.reviewItemId === second.reviewItemId);
  assert.throws(() => approveReview(states.a, { ...firstReview, expectedVersion: 'stale',
    expectedValue: firstReview.suggestedValue, confirmed: true }), /does not match/);
  approveReview(states.a, { ...firstReview, expectedValue: firstReview.suggestedValue, confirmed: true });
  assert.throws(() => approveReview(states.a, { ...secondReview, expectedValue: secondReview.suggestedValue,
    confirmed: true }), /Confirmed data changed/);
  assert.equal(states.a.repository.getReviewItem(second.reviewItemId).status, 'pending');
  denied(await propose(b.client));
  denied(await b.client.callTool({ name: 'mio_propose_update', arguments: {
    field: F.address, value: 'Other fictional address', rationale: 'B has no proposal permission.' } }));
  for (const injection of [{ requesterId: states.a.config.requesterId }, { grantId: states.a.config.grantId }]) {
    const response = await b.client.callTool({ name: 'mio_context', arguments: { fields: [F.email], ...injection } });
    assert.equal(response.isError, true);
    assert.doesNotMatch(JSON.stringify(response), /alex\./);
  }
  context(await read(b.client, [F.address, F.email]), { [F.address]: V.address }, [F.email]);
});

test('a live MCP reader waits for a short cross-process write lock and fails closed at the bounded timeout', { timeout: 15_000 }, async (t) => {
  const f = fixture(t); const { states } = f.open();
  const b = await f.connect('b');
  assert.equal(states.a.db.prepare('PRAGMA busy_timeout').get().timeout, 3000);
  let locked = false;
  let releaseTimer;
  try {
    states.a.db.exec('BEGIN IMMEDIATE'); locked = true;
    releaseTimer = setTimeout(() => { states.a.db.exec('ROLLBACK'); locked = false; }, 150);
    const started = performance.now();
    context(await read(b.client, [F.firstName, F.address]), { [F.firstName]: V.firstName, [F.address]: V.address });
    assert.ok(performance.now() - started >= 100, 'the independent reader waited for the writer');
    assert.equal(locked, false);

    const auditsBefore = states.a.repository.listAuditEventsForPerson(f.personId).length;
    states.a.db.exec('BEGIN IMMEDIATE'); locked = true;
    const blockedAt = performance.now();
    denied(await read(b.client, [F.firstName, F.address]));
    const elapsed = performance.now() - blockedAt;
    assert.ok(elapsed >= 2500 && elapsed < 8000, `expected a bounded wait, received ${Math.round(elapsed)}ms`);
    assert.equal(states.a.repository.listAuditEventsForPerson(f.personId).length, auditsBefore,
      'a timed-out read returned no values and created no success audit');
    states.a.db.exec('ROLLBACK'); locked = false;
    context(await read(b.client, [F.address]), { [F.address]: V.address });
  } finally {
    clearTimeout(releaseTimer);
    if (locked) states.a.db.exec('ROLLBACK');
  }
});

test('opening the demo rejects config path escapes, mismatched people and expanded grant declarations', (t) => {
  const f = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(f.manifestPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(f.assistants.b.configPath, 'utf8'));
  const saveConfig = (value) => fs.writeFileSync(f.assistants.b.configPath, JSON.stringify(value));
  fs.writeFileSync(f.manifestPath, JSON.stringify({ ...manifest, databasePath: path.join(f.parent, 'outside.sqlite') }));
  assert.throws(() => openSharedProfile(f.directory), /manifest/);
  fs.writeFileSync(f.manifestPath, JSON.stringify(manifest));
  saveConfig({ ...config, databasePath: path.join(f.parent, 'outside.sqlite') });
  assert.throws(() => openSharedProfile(f.directory), /shared demo database/);
  assert.equal(fs.existsSync(path.join(f.parent, 'outside.sqlite')), false);
  saveConfig({ ...config, personId: 'someone-else' });
  assert.throws(() => openSharedProfile(f.directory), /shared demo database/);
  saveConfig(config);
  const aConfig = JSON.parse(fs.readFileSync(f.assistants.a.configPath, 'utf8'));
  saveConfig(aConfig);
  assert.throws(() => openSharedProfile(f.directory), /grant does not match/);
  saveConfig(config);
  const handle = f.open();
  handle.states.b.db.prepare('UPDATE grants SET scope_json = ? WHERE id = ?')
    .run(JSON.stringify({ allowedFields: [F.firstName, F.address, F.email] }), config.grantId);
  assert.throws(() => openSharedProfile(f.directory), /grant does not match/);
});

test('opening the demo rejects symlinked files, directories and SQLite sidecars', { skip: process.platform === 'win32' }, (t) => {
  const f = fixture(t);
  const alias = path.join(f.parent, 'alias');
  fs.symlinkSync(f.directory, alias);
  assert.throws(() => openSharedProfile(alias), /regular private directory/);
  for (const file of [f.manifestPath, f.assistants.a.configPath, f.databasePath]) {
    const original = `${file}.original`;
    fs.renameSync(file, original);
    fs.symlinkSync(original, file);
    assert.throws(() => openSharedProfile(f.directory), /regular private file/);
    fs.unlinkSync(file); fs.renameSync(original, file);
  }
  // A dangling link must be rejected too: existsSync alone misses it.
  fs.symlinkSync(path.join(f.parent, 'absent'), `${f.databasePath}-wal`);
  assert.throws(() => openSharedProfile(f.directory), /regular private file/);
  fs.unlinkSync(`${f.databasePath}-wal`);
  fs.chmodSync(f.manifestPath, 0o644);
  assert.throws(() => openSharedProfile(f.directory), /owned by this user and private/);
});
