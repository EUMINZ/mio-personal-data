import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openCoreDatabase, closeCoreDatabase } from '../mio-core/src/db.js';
import { seedProfileDatabase, profileSchema, openConfiguredHost } from '../adapters/mcp/config.js';
import { AccessDenied, createScopedHost, reviewVersion } from '../adapters/mcp/host.js';
import { approveReview, rejectReview, closeStaleReview, isReviewStale, listReviews, shareClaim, revoke, initializeProfile } from '../adapters/mcp/admin.js';

const FIRST = 'person.name.first';
const EMPLOYER = 'person.employment.employer';
const TITLE = 'person.employment.job_title';
const SOURCE = { kind: 'user-stated', reference: 'Fictional travel application interview', locator: 'Current employer question' };
const FACT = { field: EMPLOYER, value: 'Example Research Ltd', rationale: 'The user supplied their current employer.', source: SOURCE };
const PROFILE = { displayName: 'Alex Rowan (fictional)', requesterName: 'Travel assistant', claims: { [FIRST]: 'Alex' },
  allowedFields: [FIRST], collectFields: [EMPLOYER, TITLE], expiresInHours: 24, allowProposals: false };

function fixture(t) {
  const db = openCoreDatabase({ filePath: ':memory:' });
  const seeded = seedProfileDatabase(db, PROFILE);
  const state = { db, ...seeded };
  t.after(() => closeCoreDatabase(db));
  return { ...state, host: createScopedHost(state.repository, state.config) };
}
function records(state) {
  return Object.fromEntries(['claims', 'evidence', 'claim_evidence_links', 'grants', 'grant_claims',
    'review_items', 'review_bundles', 'review_decisions', 'audit_events'].map((table) =>
    [table, state.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
}
function reviewFor(state, id) { return listReviews(state).find((review) => review.reviewItemId === id); }
function approve(state, review) { return approveReview(state, { ...review, expectedValue: review.suggestedValue, confirmed: true }); }
function secondRequester(state) {
  const requester = state.repository.createRequester({ name: 'Onboarding assistant', publicKeyOrIdentifier: 'new-fact-onboarding' });
  const grant = state.repository.createGrant({ personId: state.config.personId, requesterId: requester.id,
    purpose: 'Fictional onboarding', status: 'active', scope: { allowedFields: [EMPLOYER], collectFields: [EMPLOYER] },
    actions: ['read-granted-fields', 'propose-new-fact'], grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const config = { ...state.config, requesterId: requester.id, grantId: grant.id };
  return { ...state, config, host: createScopedHost(state.repository, config) };
}

test('new facts remain pending, retain reported provenance and deduplicate only identical bound proposals', (t) => {
  const state = fixture(t);
  const before = records(state);
  const proposed = state.host.proposeFact(FACT);
  const review = reviewFor(state, proposed.reviewItemId);
  assert.equal(proposed.status, 'pending');
  assert.equal(review.proposalKind, 'new-fact');
  assert.equal(review.currentValue, null);
  assert.deepEqual(review.source, SOURCE);
  const item = state.repository.getReviewItem(proposed.reviewItemId);
  assert.equal(item.metadata.expectedClaimId, null);
  assert.equal(isReviewStale(state, item), false);
  const pending = records(state);
  for (const table of ['claims', 'evidence', 'claim_evidence_links', 'grants', 'grant_claims']) assert.deepEqual(pending[table], before[table]);
  assert.equal(state.host.proposeFact(FACT).reviewItemId, proposed.reviewItemId);
  assert.deepEqual(records(state), pending);
  const another = secondRequester(state);
  const independent = another.host.proposeFact(FACT);
  assert.notEqual(independent.reviewItemId, proposed.reviewItemId);
  assert.deepEqual(listReviews(another).map((entry) => entry.reviewItemId), [independent.reviewItemId]);
  assert.deepEqual(listReviews(state).map((entry) => entry.reviewItemId), [proposed.reviewItemId]);
});

test('operator confirmation creates an unshared claim and unverified source evidence, then grants reuse separately', (t) => {
  const state = fixture(t); const other = secondRequester(state);
  const proposal = state.host.proposeFact({ ...FACT, source: { kind: 'document-extracted', reference: 'Fictional employment letter', locator: 'Page 1' } });
  const result = approve(state, reviewFor(state, proposal.reviewItemId));
  assert.equal(result.shared, false);
  const claim = state.repository.getLatestClaimForType(state.config.personId, EMPLOYER, ['confirmed']);
  assert.equal(claim.id, result.claimId);
  assert.equal(claim.issuer, 'local-operator');
  const [evidence] = state.repository.listEvidenceForPerson(state.config.personId);
  assert.equal(evidence.kind, 'reported-source');
  assert.equal(evidence.storageUri, `mio-review:${proposal.reviewItemId}`);
  assert.equal(evidence.sourceName, 'Fictional employment letter');
  assert.equal(evidence.metadata.verification, 'unverified');
  assert.equal(evidence.metadata.kind, 'document-extracted');
  assert.equal(evidence.metadata.reportedByRequesterId, state.config.requesterId);
  assert.ok(evidence.metadata.operatorConfirmedAt);
  const [link] = state.repository.listClaimEvidenceLinks(result.claimId);
  assert.equal(link.evidenceId, evidence.id);
  assert.equal(link.relationType, 'derived_from');
  assert.match(link.note, /not source authenticity/);
  for (const entry of [state, other]) assert.deepEqual(entry.host.context([EMPLOYER]).unavailable, [EMPLOYER]);
  shareClaim(state, { field: EMPLOYER, claimId: result.claimId, confirmed: true });
  assert.deepEqual(state.host.context([EMPLOYER]).fields, { [EMPLOYER]: FACT.value });
  assert.deepEqual(other.host.context([EMPLOYER]).fields, {});
  shareClaim(other, { field: EMPLOYER, claimId: result.claimId, confirmed: true });
  assert.deepEqual(other.host.context([EMPLOYER]).fields, { [EMPLOYER]: FACT.value });
  revoke(state, true);
  assert.throws(() => state.host.context([EMPLOYER]), AccessDenied);
  assert.deepEqual(other.host.context([EMPLOYER]).fields, { [EMPLOYER]: FACT.value });
});

test('collection requires its own active bound action and field scope on every call', (t) => {
  const state = fixture(t); const original = state.repository.listGrantsForPerson(state.config.personId)[0];
  const changes = [
    ['actions_json', JSON.stringify(['read-granted-fields', 'propose-update'])],
    ['scope_json', JSON.stringify({ allowedFields: [EMPLOYER], collectFields: [] })],
    ['scope_json', JSON.stringify({ allowedFields: [FIRST], collectFields: [EMPLOYER] })],
    ['scope_json', JSON.stringify({ allowedFields: [EMPLOYER], collectFields: EMPLOYER })],
    ['status', 'revoked'], ['revoked_at', new Date().toISOString()], ['expires_at', '2000-01-01T00:00:00.000Z'],
    ['expires_at', 'invalid'], ['granted_at', '2999-01-01T00:00:00.000Z'],
  ];
  for (const [column, value] of changes) {
    state.db.prepare(`UPDATE grants SET ${column} = ? WHERE id = ?`).run(value, original.id);
    const before = records(state);
    assert.throws(() => state.host.proposeFact(FACT), AccessDenied, column);
    assert.deepEqual(records(state), before);
    state.db.prepare('UPDATE grants SET actions_json = ?, scope_json = ?, status = ?, revoked_at = ?, expires_at = ?, granted_at = ? WHERE id = ?')
      .run(JSON.stringify(original.actions), JSON.stringify(original.scope), original.status, original.revokedAt, original.expiresAt, original.grantedAt, original.id);
  }
  for (const key of ['personId', 'requesterId', 'grantId']) {
    assert.throws(() => createScopedHost(state.repository, { ...state.config, [key]: 'other' }).proposeFact(FACT), AccessDenied);
  }
  // Existing update permission remains independent of collection permission.
  assert.throws(() => state.host.propose({ field: FIRST, value: 'Alec', rationale: 'Changed' }), AccessDenied);
  assert.equal(state.host.proposeFact(FACT).status, 'pending');
});

test('new-fact collection cannot replace a present, expired, ambiguous or unshared confirmed fact', (t) => {
  for (const variant of ['present', 'expired', 'ambiguous', 'future']) {
    const state = fixture(t);
    const existing = state.repository.createClaim({ personId: state.config.personId, claimTypeKey: EMPLOYER,
      value: 'Existing employer must not be disclosed', status: 'confirmed',
      expiresAt: variant === 'expired' ? '2000-01-01T00:00:00.000Z' : null,
      updatedAt: variant === 'future' ? '2999-01-01T00:00:00.000Z' : new Date().toISOString() });
    if (variant === 'ambiguous') state.repository.createClaim({ personId: state.config.personId, claimTypeKey: EMPLOYER,
      value: 'Conflicting employer', status: 'confirmed', updatedAt: existing.updatedAt });
    const before = records(state);
    assert.throws(() => state.host.proposeFact(FACT), (error) => error instanceof AccessDenied && error.message === 'Mio access denied');
    assert.deepEqual(records(state), before);
  }
});

test('invalid source, value, field and task-only answers cannot enter the queue', (t) => {
  const state = fixture(t); const before = records(state);
  const invalid = [
    { value: '' }, { value: '   ' }, { value: {} }, { value: 'x'.repeat(2049) }, { rationale: '  ' },
    { field: 'application.travel_date' }, { field: 'person.contact.email' }, { source: null }, { source: [] },
    { source: { ...SOURCE, verified: true } }, { source: { ...SOURCE, kind: 'government-verified' } },
    { source: { ...SOURCE, reference: '' } }, { source: { ...SOURCE, locator: '' } },
    { source: { ...SOURCE, reference: 'x'.repeat(301) } },
  ];
  for (const patch of invalid) assert.throws(() => state.host.proposeFact({ ...FACT, ...patch }), AccessDenied);
  assert.deepEqual(records(state), before);
});

test('review confirmation, binding and revision guards also apply to new facts; rejection creates no identity data', (t) => {
  const state = fixture(t); const other = secondRequester(state);
  const proposal = state.host.proposeFact(FACT); const review = reviewFor(state, proposal.reviewItemId);
  const args = { ...review, expectedValue: review.suggestedValue, confirmed: true };
  const before = records(state);
  assert.throws(() => approveReview(state, { ...args, confirmed: false }), /confirmation/);
  assert.throws(() => approveReview(state, { ...args, expectedValue: 'Different' }), /does not match/);
  assert.throws(() => approveReview(state, { ...args, expectedVersion: 'stale' }), /does not match/);
  assert.throws(() => approveReview(other, args), /does not match/);
  assert.deepEqual(records(state), before);
  state.db.prepare('UPDATE review_items SET metadata_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...state.repository.getReviewItem(proposal.reviewItemId).metadata, expectedClaimId: 'not-null' }), proposal.reviewItemId);
  const corrupted = state.repository.getReviewItem(proposal.reviewItemId);
  assert.throws(() => approveReview(state, { ...args, expectedVersion: reviewVersion(corrupted) }), /does not match/);
  state.db.prepare('UPDATE review_items SET metadata_json = ? WHERE id = ?').run(before.review_items[0].metadata_json, proposal.reviewItemId);
  rejectReview(state, { ...review, reason: 'This is a former employer, not my current one.', confirmed: true });
  const rejected = records(state);
  for (const table of ['claims', 'evidence', 'claim_evidence_links', 'grants', 'grant_claims']) assert.deepEqual(rejected[table], before[table]);
  assert.equal(state.repository.getReviewItem(proposal.reviewItemId).status, 'dismissed');
  assert.throws(() => approveReview(state, args), /does not match/);
});

test('competing new facts cannot both be approved; the losing proposal can close without changing the winner', (t) => {
  const state = fixture(t);
  const first = state.host.proposeFact(FACT);
  const second = state.host.proposeFact({ ...FACT, value: 'Different Example Employer' });
  const one = reviewFor(state, first.reviewItemId); const two = reviewFor(state, second.reviewItemId);
  assert.throws(() => closeStaleReview(state, { ...two, confirmed: true }), /not stale/);
  const approved = approve(state, one);
  assert.equal(isReviewStale(state, state.repository.getReviewItem(second.reviewItemId)), true);
  assert.throws(() => approve(state, two), /Confirmed data changed/);
  const before = records(state);
  closeStaleReview(state, { ...two, confirmed: true });
  const closed = records(state);
  for (const table of ['claims', 'evidence', 'claim_evidence_links', 'grants', 'grant_claims']) assert.deepEqual(closed[table], before[table]);
  assert.equal(state.repository.getLatestClaimForType(state.config.personId, EMPLOYER, ['confirmed']).id, approved.claimId);
  assert.equal(state.repository.getReviewItem(second.reviewItemId).status, 'superseded');
  assert.equal(state.repository.listReviewDecisionsForItem(second.reviewItemId).length, 1);
});

test('failed proposal and approval audits roll back source evidence, links, claim, review and decision', (t) => {
  const state = fixture(t);
  state.db.exec("CREATE TRIGGER fail_fact_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'mcp.fact.proposed' BEGIN SELECT RAISE(ABORT, 'fact audit failure'); END;");
  const before = records(state);
  assert.throws(() => state.host.proposeFact(FACT), /fact audit failure/);
  assert.deepEqual(records(state), before);
  state.db.exec('DROP TRIGGER fail_fact_audit');
  const proposal = state.host.proposeFact(FACT); const review = reviewFor(state, proposal.reviewItemId);
  state.db.exec("CREATE TRIGGER fail_fact_approval BEFORE INSERT ON audit_events WHEN NEW.event_type = 'mcp.operator.approved' BEGIN SELECT RAISE(ABORT, 'approval audit failure'); END;");
  const pending = records(state);
  assert.throws(() => approve(state, review), /approval audit failure/);
  assert.deepEqual(records(state), pending);
  state.db.exec('DROP TRIGGER fail_fact_approval');
  approve(state, review);
  assert.equal(state.repository.listEvidenceForPerson(state.config.personId).length, 1);
  assert.equal(state.repository.listReviewDecisionsForItem(review.reviewItemId).length, 1);
});

test('profile collection permission is explicit, bounded and does not widen existing profiles', (t) => {
  const { collectFields, ...oldProfile } = PROFILE;
  const parsed = profileSchema.parse(oldProfile);
  assert.deepEqual(parsed.collectFields, []);
  const state = fixture(t);
  for (const fields of [[EMPLOYER, EMPLOYER], [FIRST], ['application.travel_date']]) {
    assert.equal(profileSchema.safeParse({ ...PROFILE, collectFields: fields }).success, false);
  }
  assert.equal(profileSchema.safeParse({ ...PROFILE, allowedFields: [EMPLOYER] }).success, false);
  const grant = state.repository.listGrantsForPerson(state.config.personId)[0];
  assert.deepEqual(grant.scope, { allowedFields: [FIRST, EMPLOYER, TITLE], collectFields: [EMPLOYER, TITLE] });
  assert.ok(grant.actions.includes('propose-new-fact'));
  assert.ok(!grant.actions.includes('propose-update'));
  assert.deepEqual(state.repository.listGrantClaims(grant.id).map((item) => item.claimTypeKey), [FIRST]);
});

test('real stdio accepts scoped collection, validates source shape and preserves approval/sharing across restart', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-new-fact-'));
  const initialized = initializeProfile(path.join(directory, 'profile'), PROFILE, true);
  const state = openConfiguredHost(initialized.configPath); const clients = [];
  t.after(async () => { for (const client of clients) await client.close(); state.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function connect() {
    const client = new Client({ name: 'new-fact-test', version: '1' }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../adapters/mcp/server.js', import.meta.url)), '--config', initialized.configPath], stderr: 'pipe' }));
    return client;
  }
  const client = await connect();
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((entry) => entry.name).sort(), ['mio_context', 'mio_propose_fact', 'mio_propose_update']);
  const tool = tools.find((entry) => entry.name === 'mio_propose_fact');
  assert.ok(tool); assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.source.additionalProperties, false);
  for (const args of [{ ...FACT, personId: 'other' }, { ...FACT, source: { ...SOURCE, verified: true } }]) {
    assert.equal((await client.callTool({ name: 'mio_propose_fact', arguments: args })).isError, true);
  }
  const denied = await client.callTool({ name: 'mio_propose_fact', arguments: { ...FACT, field: 'passport.number' } });
  assert.equal(denied.isError, true);
  assert.doesNotMatch(JSON.stringify(denied), /sqlite|grant_|person_|requester_|Example Research/);
  const response = await client.callTool({ name: 'mio_propose_fact', arguments: FACT });
  assert.notEqual(response.isError, true);
  const pending = response.structuredContent ?? JSON.parse(response.content[0].text);
  await assert.rejects(() => client.callTool({ name: 'mio_approve', arguments: { reviewItemId: pending.reviewItemId, confirmed: true } }), /not found/);
  assert.equal(state.repository.getReviewItem(pending.reviewItemId).status, 'pending');
  await client.close();
  const approved = approve(state, reviewFor(state, pending.reviewItemId));
  const restarted = await connect();
  const read = async () => {
    const result = await restarted.callTool({ name: 'mio_context', arguments: { fields: [EMPLOYER] } });
    assert.notEqual(result.isError, true); return result.structuredContent;
  };
  assert.deepEqual((await read()).unavailable, [EMPLOYER]);
  shareClaim(state, { field: EMPLOYER, claimId: approved.claimId, confirmed: true });
  assert.deepEqual((await read()).fields, { [EMPLOYER]: FACT.value });
  revoke(state, true);
  assert.equal((await restarted.callTool({ name: 'mio_propose_fact', arguments: { ...FACT, field: TITLE } })).isError, true);
});
