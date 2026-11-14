import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { initializeDemo, revoke } from '../adapters/mcp/admin.js';
import { openConfiguredHost, openDemoHost } from '../adapters/mcp/config.js';
import { AccessDenied, createScopedHost } from '../adapters/mcp/host.js';
import { createMioServer } from '../adapters/mcp/server.js';

const serverPath = fileURLToPath(new URL('../adapters/mcp/server.js', import.meta.url));
const FIRST = 'person.name.first';
const EMAIL = 'person.contact.email';
const OLD = 'alex.old@example.invalid';
const NEW = 'alex.new@example.invalid';
const PASSPORT = 'passport.number';
const MISSING = 'person.name.last';
const call = (client, fields) => client.callTool({ name: 'mio_context', arguments: { fields } });
const data = (result) => {
  assert.notEqual(result.isError, true);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
};
function safeError(result) {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.doesNotMatch(JSON.stringify(result), /alex|FICTIONAL_PRIVATE|SQL|\.sqlite|grant_|person_|requester_|internal-secret/);
}
async function connect(args, env) {
  const client = new Client({ name: 'mio-context-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath, ...args], env, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', (chunk) => { stderr += chunk; });
  try { await client.connect(transport); }
  catch (error) { await client.close(); throw error; }
  return { client, close: async () => {
    await client.close();
    assert.doesNotMatch(stderr, /FICTIONAL_PRIVATE|internal-secret/);
  } };
}
async function fixture(t, { envConfig = false, legacyLast = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-context-test-'));
  const initialized = initializeDemo(path.join(directory, 'private'));
  const state = openConfiguredHost(initialized.configPath);
  const args = envConfig ? [] : ['--config', initialized.configPath, ...(legacyLast ? ['--legacy-tools'] : [])];
  const connection = await connect(args, envConfig ? { ...process.env, MIO_CONFIG: initialized.configPath } : undefined);
  t.after(async () => { await connection.close(); state.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { ...state, client: connection.client, configPath: initialized.configPath };
}
function assertContext(result, fields, unavailable = []) {
  const context = data(result);
  assert.deepEqual(context.fields, fields);
  assert.deepEqual(context.unavailable, unavailable);
  assert.deepEqual(Object.keys(context).sort(), ['checkedAt', 'fields', 'unavailable']);
  assert.equal(new Date(context.checkedAt).toISOString(), context.checkedAt);
  return context;
}

test('compact stdio advertises two strict tools and returns a deduplicated batch in one audited read', async (t) => {
  const state = await fixture(t); const { client, repository, config } = state;
  assert.equal(client.getServerVersion().version, '0.3.0-alpha');
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['mio_context', 'mio_propose_update']);
  assert.ok(tools.every((tool) => tool.inputSchema.additionalProperties === false));
  const before = repository.listAuditEventsForPerson(config.personId).length;
  const started = Date.now();
  const response = await call(client, [FIRST, EMAIL, FIRST, PASSPORT, MISSING, PASSPORT]);
  const context = assertContext(response, { [FIRST]: 'Alex', [EMAIL]: OLD }, [PASSPORT, MISSING]);
  assert.ok(Date.parse(context.checkedAt) >= started && Date.parse(context.checkedAt) <= Date.now());
  assert.doesNotMatch(JSON.stringify(response), /FICTIONAL_PRIVATE|evidence|grantId|personId|requesterId/);
  const audits = repository.listAuditEventsForPerson(config.personId);
  assert.equal(audits.length, before + 1);
  assert.equal(audits[0].eventType, 'mcp.context.read');
  assert.deepEqual(audits[0].eventPayload, { grantId: config.grantId, fields: [FIRST, EMAIL], unavailable: [PASSPORT, MISSING] });
  assert.equal(audits[0].createdAt, context.checkedAt);
});

test('compact stdio rejects malformed batches and caller-controlled bindings without executing a read', async (t) => {
  const state = await fixture(t); const { client, repository, config } = state;
  const before = repository.listAuditEventsForPerson(config.personId).length;
  const invalid = [
    { fields: null }, { fields: [] }, { fields: [1] }, { fields: [''] }, { fields: ['x'.repeat(121)] },
    { fields: Array(51).fill(FIRST) }, { fields: [FIRST], personId: 'other' },
    { fields: [FIRST], requesterId: 'other' }, { fields: [FIRST], grantId: 'other' },
    { fields: [FIRST], includeUnshared: true },
  ];
  for (const arguments_ of invalid) {
    assert.equal((await client.callTool({ name: 'mio_context', arguments: arguments_ })).isError, true);
  }
  assert.equal(repository.listAuditEventsForPerson(config.personId).length, before);
  assertContext(await call(client, Array(50).fill(FIRST)), { [FIRST]: 'Alex' });
});

test('omitting context fields discovers readable keys only, preserves the grant check and rejects extra arguments', async (t) => {
  const { client, repository, config } = await fixture(t);
  const discover = (arguments_ = {}) => client.callTool({ name: 'mio_context', arguments: arguments_ });
  const before = repository.listAuditEventsForPerson(config.personId).length;
  const response = await discover();
  assert.deepEqual(data(response), { fields: [EMAIL, FIRST] });
  assert.doesNotMatch(JSON.stringify(response), /alex|Alex|passport|FICTIONAL_PRIVATE/);
  const audits = repository.listAuditEventsForPerson(config.personId);
  assert.equal(audits.length, before + 1);
  assert.equal(audits[0].eventType, 'mcp.fields.listed');
  for (const args of [{ includePrivate: true }, { requesterId: 'other' }, { grantId: 'other' }]) {
    assert.equal((await discover(args)).isError, true);
  }
  assert.equal(repository.listAuditEventsForPerson(config.personId).length, before + 1);
  revoke({ repository, config }, true);
  safeError(await discover());
});

test('running compact server checks grant expiry, malformed dates, actions and revocation on every batch', async (t) => {
  const { client, repository, config, db } = await fixture(t);
  const original = repository.listGrantsForPerson(config.personId)[0];
  assertContext(await call(client, [FIRST, EMAIL]), { [FIRST]: 'Alex', [EMAIL]: OLD });
  for (const expiresAt of ['2000-01-01T00:00:00.000Z', 'not-a-date']) {
    db.prepare('UPDATE grants SET expires_at = ? WHERE id = ?').run(expiresAt, config.grantId);
    safeError(await call(client, [FIRST, EMAIL]));
  }
  db.prepare('UPDATE grants SET expires_at = ?, granted_at = ? WHERE id = ?')
    .run(original.expiresAt, new Date(Date.now() + 60_000).toISOString(), config.grantId);
  safeError(await call(client, [FIRST]));
  db.prepare('UPDATE grants SET granted_at = ?, actions_json = ? WHERE id = ?')
    .run(original.grantedAt, JSON.stringify(['propose-update']), config.grantId);
  safeError(await call(client, [FIRST]));
  db.prepare('UPDATE grants SET actions_json = ? WHERE id = ?').run(JSON.stringify(original.actions), config.grantId);
  assertContext(await call(client, [EMAIL]), { [EMAIL]: OLD });
  revoke({ repository, config }, true);
  safeError(await call(client, [FIRST, EMAIL]));
});

test('compact per-field missing, expired, invalid, future and ambiguous facts share one unavailable representation', async (t) => {
  const { client, repository, config, db } = await fixture(t);
  const email = repository.getLatestClaimForType(config.personId, EMAIL, ['confirmed']);
  const reset = () => db.prepare('UPDATE claims SET status = ?, expires_at = ?, updated_at = ? WHERE id = ?')
    .run('confirmed', null, '2020-01-01T00:00:00.000Z', email.id);
  const unavailableEmail = async () => assertContext(await call(client, [FIRST, EMAIL]), { [FIRST]: 'Alex' }, [EMAIL]);
  for (const [column, value] of [
    ['status', 'extracted'], ['expires_at', '2000-01-01T00:00:00.000Z'], ['expires_at', 'not-a-date'],
    ['updated_at', 'not-a-date'], ['updated_at', new Date(Date.now() + 60_000).toISOString()],
  ]) {
    reset(); db.prepare(`UPDATE claims SET ${column} = ? WHERE id = ?`).run(value, email.id);
    await unavailableEmail();
  }
  reset();
  const conflict = repository.createClaim({ personId: config.personId, claimTypeKey: EMAIL, value: NEW,
    status: 'confirmed', createdAt: '2020-01-01T00:00:00.000Z' });
  repository.attachGrantClaim({ grantId: config.grantId, claimId: conflict.id, accessMode: 'read' });
  await unavailableEmail();
  db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('revoked', conflict.id);
  assertContext(await call(client, [FIRST, EMAIL, MISSING, PASSPORT]), { [FIRST]: 'Alex', [EMAIL]: OLD }, [MISSING, PASSPORT]);
});

test('compact reads never reuse cached facts and require the exact updated revision to be shared', async (t) => {
  const { client, repository, config, db } = await fixture(t);
  const original = repository.getLatestClaimForType(config.personId, EMAIL, ['confirmed']);
  db.prepare('UPDATE claims SET updated_at = ? WHERE id = ?').run('2020-01-02T11:00:00.000Z', original.id);
  assertContext(await call(client, [EMAIL]), { [EMAIL]: OLD });
  const newer = repository.createClaim({ personId: config.personId, claimTypeKey: EMAIL, value: NEW,
    status: 'confirmed', createdAt: '2020-01-02T10:00:00-02:00' });
  assertContext(await call(client, [EMAIL]), {}, [EMAIL]);
  repository.attachGrantClaim({ grantId: config.grantId, claimId: newer.id, accessMode: 'read' });
  assertContext(await call(client, [EMAIL]), { [EMAIL]: NEW });
  const proposal = data(await client.callTool({ name: 'mio_propose_update', arguments: {
    field: EMAIL, value: 'alex.pending@example.invalid', rationale: 'Fictional proposed correction.',
  } }));
  assert.equal(proposal.status, 'pending');
  assertContext(await call(client, [EMAIL]), { [EMAIL]: NEW });
});

test('compact stdio returns no partial data or internal details when the batch audit fails', async (t) => {
  const { client, repository, config, db } = await fixture(t);
  const count = repository.listAuditEventsForPerson(config.personId).length;
  db.exec(`CREATE TRIGGER fail_context_audit BEFORE INSERT ON audit_events
    WHEN NEW.event_type = 'mcp.context.read'
    BEGIN SELECT RAISE(ABORT, 'internal-secret /private/database.sqlite'); END;`);
  safeError(await call(client, [FIRST, EMAIL, PASSPORT]));
  assert.equal(repository.listAuditEventsForPerson(config.personId).length, count);
  db.exec('DROP TRIGGER fail_context_audit');
  assertContext(await call(client, [FIRST]), { [FIRST]: 'Alex' });
});

test('context transaction rolls back a written audit and propagates database failures instead of marking fields unavailable', (t) => {
  const state = openDemoHost(); t.after(() => state.close());
  const { repository, config } = state;
  const host = createScopedHost(repository, config);
  const originalAudit = repository.createAuditEvent;
  const before = repository.listAuditEventsForPerson(config.personId).length;
  repository.createAuditEvent = function (event) { originalAudit.call(this, event); throw new Error('injected post-write failure'); };
  assert.throws(() => host.context([FIRST, EMAIL]), /injected post-write failure/);
  assert.equal(repository.listAuditEventsForPerson(config.personId).length, before);
  repository.createAuditEvent = originalAudit;
  const originalClaims = repository.listClaimsForPerson; let reads = 0;
  repository.listClaimsForPerson = function (...args) {
    if (++reads === 2) throw new Error('injected database failure');
    return originalClaims.apply(this, args);
  };
  assert.throws(() => host.context([FIRST, EMAIL]), /injected database failure/);
  assert.equal(repository.listAuditEventsForPerson(config.personId).length, before);
});

test('direct context API rejects invalid input, clock or binding and does not silently choose an unknown toolset', (t) => {
  const state = openDemoHost(); t.after(() => state.close());
  const host = createScopedHost(state.repository, state.config);
  for (const fields of [undefined, null, FIRST, [], [1], [''], ['x'.repeat(121)], Array(51).fill(FIRST)]) {
    assert.throws(() => host.context(fields), AccessDenied);
  }
  for (const clock of [() => NaN, () => Infinity]) {
    assert.throws(() => createScopedHost(state.repository, state.config, { clock }).context([FIRST]), AccessDenied);
  }
  assert.throws(() => createScopedHost(state.repository, { ...state.config, requesterId: 'other' }).context([FIRST]), AccessDenied);
  assert.throws(() => createMioServer(host, { toolset: 'invalid' }), /Unknown Mio toolset/);
});

test('environment-configured launch defaults to compact and a trailing legacy flag preserves legacy tools', async (t) => {
  const compact = await fixture(t, { envConfig: true });
  assertContext(await call(compact.client, [FIRST]), { [FIRST]: 'Alex' });
  const legacy = await fixture(t, { legacyLast: true });
  assert.deepEqual((await legacy.client.listTools()).tools.map((tool) => tool.name).sort(), ['mio_list_fields', 'mio_propose_update', 'mio_read']);
  assert.deepEqual(data(await legacy.client.callTool({ name: 'mio_read', arguments: { fields: [FIRST] } })), { fields: { [FIRST]: 'Alex' } });
});
