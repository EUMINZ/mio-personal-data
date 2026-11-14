import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { initializeDemo, initializeProfile, listReviews, approveReview, shareClaim, revoke } from '../adapters/mcp/admin.js';
import { openConfiguredHost } from '../adapters/mcp/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'adapters/mcp/server.js');
const EMAIL = 'person.contact.email';
const FIRST = 'person.name.first';
const OLD = 'alex.old@example.invalid';
const NEW = 'alex.new@example.invalid';
async function connect(t, args) {
  const client = new Client({ name: 'mio-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [server, ...args], stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', (chunk) => { stderr += chunk; });
  await client.connect(transport);
  t.after(async () => { await client.close(); assert.doesNotMatch(stderr, /FICTIONAL_PRIVATE_DO_NOT_DISCLOSE/); });
  return client;
}
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-mcp-test-'));
  const directory = path.join(parent, 'private');
  const initialized = initializeDemo(directory);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { ...initialized, directory };
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const data = (result) => { assert.notEqual(result.isError, true); return result.structuredContent ?? JSON.parse(result.content[0].text); };
const read = (client, fields = [EMAIL]) => call(client, 'mio_read', { fields });
const proposal = (client, value = NEW) => call(client, 'mio_propose_update', { field: EMAIL, value, rationale: 'Fictional user correction for review.' });

test('real stdio initializes, advertises only three strict tools and minimizes responses', async (t) => {
  const client = await connect(t, ['--demo']);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((entry) => entry.name).sort(), ['mio_list_fields', 'mio_propose_update', 'mio_read']);
  assert.ok(tools.every((entry) => entry.inputSchema.additionalProperties === false));
  assert.deepEqual(data(await call(client, 'mio_list_fields')), { fields: [EMAIL, FIRST] });
  assert.deepEqual(data(await read(client, [FIRST])), { fields: { [FIRST]: 'Alex' } });
  const email = await read(client);
  assert.deepEqual(data(email), { fields: { [EMAIL]: OLD } });
  assert.doesNotMatch(JSON.stringify(email), /passport|evidence|grantId|personId|requesterId|FICTIONAL_PRIVATE/);
});

test('real stdio rejects unscoped fields, caller bindings, extra keys and invalid data', async (t) => {
  const client = await connect(t, ['--demo']);
  const denied = [
    ['mio_read', { fields: ['passport.number'] }],
    ['mio_read', { fields: [EMAIL, 'passport.number'] }],
    ['mio_read', { fields: [EMAIL], personId: 'other-person' }],
    ['mio_read', { fields: [EMAIL], requesterId: 'other-requester' }],
    ['mio_read', { fields: [EMAIL], grantId: 'other-grant' }],
    ['mio_read', { fields: [] }],
    ['mio_read', { fields: [1] }],
    ['mio_list_fields', { includePrivate: true }],
    ['mio_propose_update', { field: 'passport.number', value: 'X', rationale: 'Unauthorized' }],
    ['mio_propose_update', { field: EMAIL, value: NEW, rationale: 'x', approved: true }],
    ['mio_propose_update', { field: EMAIL, value: { injected: true }, rationale: 'x' }],
    ['mio_propose_update', { field: EMAIL, value: 'x'.repeat(2049), rationale: 'x' }],
  ];
  for (const [name, args] of denied) assert.equal((await call(client, name, args)).isError, true, `${name}: ${JSON.stringify(args)}`);
  assert.deepEqual(data(await read(client)), { fields: { [EMAIL]: OLD } });
});

test('persistent proposal survives restart, requires exact human confirmation, and needs separate sharing', async (t) => {
  const fixtureData = fixture(t);
  const client = await connect(t, ['--config', fixtureData.configPath]);
  const pending = data(await proposal(client));
  assert.equal(pending.status, 'pending');
  assert.deepEqual(data(await read(client)), { fields: { [EMAIL]: OLD } });
  await client.close();
  const state = openConfiguredHost(fixtureData.configPath);
  try {
    const [review] = listReviews(state);
    assert.equal(review.reviewItemId, pending.reviewItemId);
    assert.equal(review.suggestedValue, NEW);
    assert.throws(() => approveReview(state, { ...review, expectedValue: NEW }), /confirmation/);
    assert.throws(() => approveReview(state, { ...review, expectedValue: OLD, confirmed: true }), /does not match/);
    assert.throws(() => approveReview(state, { ...review, expectedVersion: 'stale', expectedValue: NEW, confirmed: true }), /does not match/);
    const approved = approveReview(state, { ...review, expectedValue: NEW, confirmed: true });
    assert.equal(approved.shared, false);
    assert.equal(state.repository.getReviewItem(review.reviewItemId).status, 'applied');
    const restarted = await connect(t, ['--config', fixtureData.configPath]);
    assert.equal((await read(restarted)).isError, true);
    assert.deepEqual(data(await call(restarted, 'mio_list_fields')), { fields: [FIRST] });
    assert.throws(() => shareClaim(state, { field: EMAIL, claimId: approved.claimId }), /confirmation/);
    shareClaim(state, { field: EMAIL, claimId: approved.claimId, confirmed: true });
    assert.deepEqual(data(await read(restarted)), { fields: { [EMAIL]: NEW } });
    assert.throws(() => approveReview(state, { ...review, expectedValue: NEW, confirmed: true }), /does not match/);
    await restarted.close();
  } finally { state.close(); }
});

test('running stdio server rechecks expiry and revocation for list, read and proposal', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    const client = await connect(t, ['--config', f.configPath]);
    assert.equal(data(await read(client)).fields[EMAIL], OLD);
    state.db.prepare('UPDATE grants SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', state.config.grantId);
    for (const result of [await read(client), await call(client, 'mio_list_fields'), await proposal(client)]) assert.equal(result.isError, true);
    assert.equal(listReviews(state).length, 0);
    state.db.prepare('UPDATE grants SET expires_at = ? WHERE id = ?').run(new Date(Date.now() + 60_000).toISOString(), state.config.grantId);
    assert.equal(data(await read(client)).fields[EMAIL], OLD);
    revoke(state, true);
    for (const result of [await read(client), await call(client, 'mio_list_fields'), await proposal(client)]) assert.equal(result.isError, true);
    assert.equal(listReviews(state).length, 0);
    await client.close();
  } finally { state.close(); }
});

test('real stdio denies malformed/future grants and claims without the exact current attachment', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    const client = await connect(t, ['--config', f.configPath]);
    const originalGrant = state.repository.listGrantsForPerson(state.config.personId)[0];
    state.db.prepare('UPDATE grants SET expires_at = ? WHERE id = ?').run('not-a-date', state.config.grantId);
    assert.equal((await read(client)).isError, true);
    state.db.prepare('UPDATE grants SET expires_at = ?, granted_at = ? WHERE id = ?')
      .run(originalGrant.expiresAt, new Date(Date.now() + 60_000).toISOString(), state.config.grantId);
    assert.equal((await read(client)).isError, true);
    state.db.prepare('UPDATE grants SET granted_at = ? WHERE id = ?').run(originalGrant.grantedAt, state.config.grantId);
    const oldClaim = state.repository.getLatestClaimForType(state.config.personId, EMAIL, ['confirmed']);
    state.repository.createClaim({ personId: state.config.personId, claimTypeKey: EMAIL, value: NEW, status: 'confirmed' });
    assert.ok(state.repository.listGrantClaims(state.config.grantId).some((link) => link.claimId === oldClaim.id));
    assert.equal((await read(client)).isError, true);
    assert.deepEqual(data(await call(client, 'mio_list_fields')), { fields: [FIRST] });
    await client.close();
  } finally { state.close(); }
});

test('proposal permission is separate from read permission', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    state.db.prepare('UPDATE grants SET actions_json = ? WHERE id = ?').run(JSON.stringify(['read-granted-fields']), state.config.grantId);
    const client = await connect(t, ['--config', f.configPath]);
    assert.equal(data(await read(client)).fields[EMAIL], OLD);
    assert.equal((await proposal(client)).isError, true);
    assert.equal(listReviews(state).length, 0);
    await client.close();
  } finally { state.close(); }
});

test('approval checks claim identity and rolls back the entire change on audit failure', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    const client = await connect(t, ['--config', f.configPath]);
    data(await proposal(client));
    const [review] = listReviews(state);
    const before = state.repository.listClaimsForPerson(state.config.personId).length;
    state.db.exec(`CREATE TRIGGER fail_operator_audit BEFORE INSERT ON audit_events
      WHEN NEW.event_type = 'mcp.operator.approved'
      BEGIN SELECT RAISE(ABORT, 'test operator audit failure'); END;`);
    assert.throws(() => approveReview(state, { ...review, expectedValue: NEW, confirmed: true }), /test operator audit failure/);
    assert.equal(state.repository.listClaimsForPerson(state.config.personId).length, before);
    assert.equal(state.repository.getReviewItem(review.reviewItemId).status, 'pending');
    assert.equal(state.repository.listReviewDecisionsForItem(review.reviewItemId).length, 0);
    assert.equal(data(await read(client)).fields[EMAIL], OLD);
    state.db.exec('DROP TRIGGER fail_operator_audit');
    state.repository.createClaim({ personId: state.config.personId, claimTypeKey: EMAIL, value: OLD, status: 'confirmed' });
    assert.throws(() => approveReview(state, { ...review, expectedValue: NEW, confirmed: true }), /Confirmed data changed/);
    await client.close();
  } finally { state.close(); }
});

test('operator initialization refuses overwrite and creates private config/database permissions', (t) => {
  const f = fixture(t);
  assert.throws(() => initializeDemo(f.directory), /EEXIST/);
  assert.throws(() => initializeDemo('relative-path'), /absolute/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(f.configPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(f.databasePath).mode & 0o777, 0o600);
    fs.chmodSync(f.configPath, 0o644);
    assert.throws(() => openConfiguredHost(f.configPath), /0600/);
  }
  const run = spawnSync(process.execPath, [server, '--demo', '--config', f.configPath], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
});


test('explicit profile import shares only selected supported fields and cannot be implicit', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-profile-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const profile = { displayName: 'Fictional Jamie', requesterName: 'Fictional assistant',
    claims: { [FIRST]: 'Jamie', [EMAIL]: 'jamie@example.invalid', 'passport.number': 'DO_NOT_RETURN' },
    allowedFields: [FIRST], expiresInHours: 2, allowProposals: false };
  const directory = path.join(parent, 'private');
  assert.throws(() => initializeProfile(directory, profile), /confirmation/);
  assert.throws(() => initializeProfile(directory, { ...profile, allowedFields: ['unknown.field'] }, true), /subset/);
  assert.throws(() => initializeProfile(directory, { ...profile, claims: { unknown: 'bad' } }, true), /Unsupported/);
  assert.throws(() => initializeProfile(directory, { ...profile, allowProposals: undefined }, true));
  assert.equal(fs.existsSync(directory), false);
  const initialized = initializeProfile(directory, profile, true);
  const client = await connect(t, ['--config', initialized.configPath]);
  assert.deepEqual(data(await call(client, 'mio_list_fields')), { fields: [FIRST] });
  assert.deepEqual(data(await read(client, [FIRST])), { fields: { [FIRST]: 'Jamie' } });
  assert.equal((await read(client)).isError, true);
  assert.equal((await call(client, 'mio_propose_update', { field: FIRST, value: 'J', rationale: 'x' })).isError, true);
  await client.close();
});

test('npm-style symlink launcher starts a usable stdio server', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-bin-test-'));
  const bin = path.join(parent, 'mio-mcp');
  fs.symlinkSync(server, bin);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const client = new Client({ name: 'mio-bin-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, '--demo'], stderr: 'pipe' }));
    assert.equal(data(await read(client)).fields[EMAIL], OLD);
  } finally { await client.close(); }
});

test('real stdio cannot use a configured grant for a different person or requester', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    const anotherPerson = state.repository.createPerson({ displayName: 'Other fictional person' });
    const anotherRequester = state.repository.createRequester({ name: 'Other requester', publicKeyOrIdentifier: 'other-mcp-test' });
    for (const changes of [{ personId: anotherPerson.id }, { requesterId: anotherRequester.id }]) {
      const configPath = path.join(f.directory, `${Object.keys(changes)[0]}.json`);
      fs.writeFileSync(configPath, JSON.stringify({ ...state.config, ...changes }), { mode: 0o600 });
      const client = await connect(t, ['--config', configPath]);
      for (const result of [await read(client), await call(client, 'mio_list_fields'), await proposal(client)]) assert.equal(result.isError, true);
      await client.close();
    }
    assert.equal(listReviews(state).length, 0);
  } finally { state.close(); }
});

test('operator CLI performs review, version-checked approval, explicit share and revoke', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-admin-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const admin = path.join(root, 'adapters/mcp/admin.js');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [admin, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const f = run('init-demo', path.join(parent, 'private'));
  const client = await connect(t, ['--config', f.configPath]);
  data(await proposal(client));
  const [review] = run('reviews', f.configPath);
  const approved = run('approve', f.configPath, review.reviewItemId, review.expectedVersion, JSON.stringify(NEW), '--confirm');
  assert.equal(approved.shared, false);
  assert.equal((await read(client)).isError, true);
  run('share', f.configPath, '--field', EMAIL, '--claim-id', approved.claimId, '--confirm');
  assert.equal(data(await read(client)).fields[EMAIL], NEW);
  run('revoke', f.configPath, '--confirm');
  assert.equal((await read(client)).isError, true);
  await client.close();
});

test('newer offset timestamps cannot expose an old granted claim; equal instants and invalid times fail closed', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    const client = await connect(t, ['--config', f.configPath]);
    const oldClaim = state.repository.getLatestClaimForType(state.config.personId, EMAIL, ['confirmed']);
    state.db.prepare('UPDATE claims SET updated_at = ? WHERE id = ?').run('2020-01-02T11:00:00.000Z', oldClaim.id);
    const newer = state.repository.createClaim({ personId: state.config.personId, claimTypeKey: EMAIL, value: NEW,
      status: 'confirmed', createdAt: '2020-01-02T10:00:00-02:00' }); // 12:00 UTC, newer than 11:00.
    assert.equal((await read(client)).isError, true);
    state.repository.attachGrantClaim({ grantId: state.config.grantId, claimId: newer.id, accessMode: 'read' });
    assert.equal(data(await read(client)).fields[EMAIL], NEW);
    state.db.prepare('UPDATE claims SET updated_at = ? WHERE id = ?').run('2020-01-02T09:00:00-02:00', newer.id); // Same 11:00 instant.
    assert.equal((await read(client)).isError, true);
    state.db.prepare('UPDATE claims SET updated_at = ? WHERE id = ?').run('not-a-date', newer.id);
    assert.equal((await read(client)).isError, true);
    assert.deepEqual(data(await call(client, 'mio_list_fields')), { fields: [FIRST] });
    await client.close();
  } finally { state.close(); }
});

test('proposal and separate sharing transactions roll back completely when audit fails', async (t) => {
  const f = fixture(t); const state = openConfiguredHost(f.configPath);
  try {
    const client = await connect(t, ['--config', f.configPath]);
    state.db.exec(`CREATE TRIGGER fail_proposal_audit BEFORE INSERT ON audit_events
      WHEN NEW.event_type = 'mcp.update.proposed'
      BEGIN SELECT RAISE(ABORT, 'test proposal audit failure'); END;`);
    assert.equal((await proposal(client)).isError, true);
    assert.equal(state.repository.listReviewBundlesForPerson(state.config.personId).length, 0);
    assert.equal(listReviews(state).length, 0);
    state.db.exec('DROP TRIGGER fail_proposal_audit');
    data(await proposal(client));
    const [review] = listReviews(state);
    const approved = approveReview(state, { ...review, expectedValue: NEW, confirmed: true });
    const attachedBefore = state.repository.listGrantClaims(state.config.grantId).length;
    state.db.exec(`CREATE TRIGGER fail_share_audit BEFORE INSERT ON audit_events
      WHEN NEW.event_type = 'mcp.operator.shared'
      BEGIN SELECT RAISE(ABORT, 'test share audit failure'); END;`);
    assert.throws(() => shareClaim(state, { field: EMAIL, claimId: approved.claimId, confirmed: true }), /test share audit failure/);
    assert.equal(state.repository.listGrantClaims(state.config.grantId).length, attachedBefore);
    assert.equal((await read(client)).isError, true);
    state.db.exec('DROP TRIGGER fail_share_audit');
    shareClaim(state, { field: EMAIL, claimId: approved.claimId, confirmed: true });
    assert.equal(data(await read(client)).fields[EMAIL], NEW);
    await client.close();
  } finally { state.close(); }
});
