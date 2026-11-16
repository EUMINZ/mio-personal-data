import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeSharedProfile, openSharedProfile, SHARED_PROFILE_FIELDS as F, SHARED_PROFILE_VALUES as V } from '../examples/shared-profile/fixture.js';
import { createScopedHost, reviewVersion } from '../adapters/mcp/host.js';
import { approveReview, closeStaleReview, isReviewStale, listReviews, rejectReview, revoke } from '../adapters/mcp/admin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = path.join(root, 'adapters/mcp/admin.js');
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-review-resolution-'));
  const directory = path.join(parent, 'profile');
  initializeSharedProfile(directory);
  const demo = openSharedProfile(directory);
  t.after(() => { demo.close(); fs.rmSync(parent, { recursive: true, force: true }); });
  return { ...demo, directory };
}
function propose(state, value = V.nextEmail) {
  const result = createScopedHost(state.repository, state.config).propose({ field: F.email, value, rationale: 'Fictional correction' });
  return listReviews(state).find((item) => item.reviewItemId === result.reviewItemId);
}
function rows(state, tables) {
  return Object.fromEntries(tables.map((table) => [table, state.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
}
const factsAndGrants = (state) => rows(state, ['claims', 'grants', 'grant_claims']);
const allRecords = (state) => rows(state, ['claims', 'grants', 'grant_claims', 'review_items', 'review_bundles', 'review_decisions', 'audit_events']);
const rejectArgs = (review) => ({ ...review, reason: 'Incorrect suggestion', confirmed: true });

test('rejecting records a reason and terminal decision without changing facts or sharing', (t) => {
  const { states } = fixture(t); const state = states.a;
  const review = propose(state);
  const original = state.repository.getReviewItem(review.reviewItemId);
  const before = factsAndGrants(state);
  const result = rejectReview(state, { ...rejectArgs(review), reason: '  The proposed address is incorrect.  ' });
  assert.deepEqual(result, { reviewItemId: review.reviewItemId, status: 'dismissed', decision: 'dismissed' });
  assert.deepEqual(factsAndGrants(state), before);
  assert.deepEqual(listReviews(state), []);
  const item = state.repository.getReviewItem(review.reviewItemId);
  assert.equal(item.status, 'dismissed');
  assert.equal(item.resolutionNote, 'The proposed address is incorrect.');
  assert.equal(item.appliedClaimId, null);
  assert.equal(item.resolvedByActorId, 'local-operator');
  assert.ok(Number.isFinite(Date.parse(item.resolvedAt)));
  for (const key of ['suggestedValue', 'currentValue', 'rationale', 'metadata']) assert.deepEqual(item[key], original[key]);
  const [decision] = state.repository.listReviewDecisionsForItem(item.id);
  assert.equal(decision.decision, 'dismissed');
  assert.equal(decision.note, item.resolutionNote);
  assert.equal(decision.appliedClaimId, null);
  assert.equal(state.repository.getReviewBundle(item.bundleId).status, 'dismissed');
  assert.equal(state.repository.listAuditEventsForPerson(state.config.personId).filter((event) => event.eventType === 'mcp.operator.rejected').length, 1);
  assert.equal(createScopedHost(state.repository, state.config).read([F.email]).fields[F.email], V.email);
  assert.equal(createScopedHost(states.b.repository, states.b.config).read([F.address]).fields[F.address], V.address);
  const resolved = allRecords(state);
  assert.throws(() => rejectReview(state, rejectArgs(review)), /does not match/);
  assert.throws(() => approveReview(state, { ...review, expectedValue: V.nextEmail, confirmed: true }), /does not match/);
  assert.deepEqual(allRecords(state), resolved);
});

test('rejection and closure require confirmation, a current review token and the configured binding', (t) => {
  const { states } = fixture(t); const state = states.a;
  const review = propose(state);
  const before = allRecords(state);
  for (const reason of [undefined, null, {}, '', ' \n ', 'x'.repeat(1001)]) {
    assert.throws(() => rejectReview(state, { ...rejectArgs(review), reason }), /reason/);
  }
  for (const operation of [rejectReview, closeStaleReview]) {
    assert.throws(() => operation(state, { ...rejectArgs(review), confirmed: false }), /confirmation/);
    assert.throws(() => operation(state, { ...rejectArgs(review), expectedVersion: 'outdated' }), /does not match/);
    assert.throws(() => operation(state, { ...rejectArgs(review), reviewItemId: 'unknown' }), /does not match/);
    assert.throws(() => operation(states.b, rejectArgs(review)), /does not match/);
    for (const key of ['personId', 'requesterId', 'grantId']) {
      assert.throws(() => operation({ ...state, config: { ...state.config, [key]: 'other' } }, rejectArgs(review)), /does not match/);
    }
  }
  assert.deepEqual(allRecords(state), before);
});

test('field and proposal identity cannot be replaced even with a freshly computed review token', (t) => {
  const { states } = fixture(t); const state = states.a;
  const review = propose(state);
  const original = state.repository.getReviewItem(review.reviewItemId);
  for (const patch of [
    { column: 'field_key', value: 'homeAddress' },
    { column: 'target', value: 'service_context' },
    { column: 'item_type', value: 'observation' },
    { column: 'metadata_json', value: JSON.stringify({ ...original.metadata, adapter: 'other' }) },
  ]) {
    state.db.prepare(`UPDATE review_items SET ${patch.column} = ? WHERE id = ?`).run(patch.value, original.id);
    const item = state.repository.getReviewItem(original.id);
    const before = allRecords(state);
    for (const operation of [rejectReview, closeStaleReview]) {
      assert.throws(() => operation(state, { ...rejectArgs(review), expectedVersion: reviewVersion(item) }), /does not match/);
    }
    assert.deepEqual(allRecords(state), before);
    state.db.prepare('UPDATE review_items SET field_key = ?, target = ?, item_type = ?, metadata_json = ? WHERE id = ?')
      .run(original.fieldKey, original.target, original.itemType, JSON.stringify(original.metadata), original.id);
  }
});

test('closing an outdated proposal preserves the newer fact and its existing sharing decisions', (t) => {
  const { states, directory } = fixture(t); const state = states.a;
  const first = propose(state); const second = propose(state, 'alex.other@example.invalid');
  assert.equal(isReviewStale(state, state.repository.getReviewItem(second.reviewItemId)), false);
  const before = allRecords(state);
  assert.throws(() => closeStaleReview(state, { ...second, confirmed: true }), /not stale/);
  assert.deepEqual(allRecords(state), before);
  const approved = approveReview(state, { ...first, expectedValue: V.nextEmail, confirmed: true });
  const changed = factsAndGrants(state);
  const original = state.repository.getReviewItem(second.reviewItemId);
  assert.equal(isReviewStale(state, original), true);
  assert.throws(() => approveReview(state, { ...second, expectedValue: second.suggestedValue, confirmed: true }), /Confirmed data changed/);
  assert.equal(closeStaleReview(state, { ...second, confirmed: true }).status, 'superseded');
  assert.deepEqual(factsAndGrants(state), changed);
  assert.equal(state.repository.getReviewItem(second.reviewItemId).suggestedValue, original.suggestedValue);
  const [decision] = state.repository.listReviewDecisionsForItem(second.reviewItemId);
  assert.equal(decision.decision, 'superseded');
  assert.match(decision.note, /no longer matches/);
  assert.equal(state.repository.getReviewItem(second.reviewItemId).resolutionNote, decision.note);
  assert.equal(state.repository.getReviewItem(second.reviewItemId).appliedClaimId, null);
  assert.ok(!state.repository.listGrantClaims(state.config.grantId).some((link) => link.claimId === approved.claimId));
  const resolved = allRecords(state);
  assert.throws(() => closeStaleReview(state, { ...second, confirmed: true }), /does not match/);
  assert.deepEqual(allRecords(state), resolved);
  const reopened = openSharedProfile(directory);
  try {
    assert.deepEqual(listReviews(reopened.states.a), []);
    assert.equal(reopened.states.a.repository.getReviewItem(second.reviewItemId).status, 'superseded');
    assert.deepEqual(factsAndGrants(reopened.states.a), changed);
  } finally { reopened.close(); }
});

test('approval and stale closure agree on changed, missing, ambiguous, expired and invalid facts', (t) => {
  for (const change of ['value', 'missing', 'ambiguous', 'expired', 'future', 'invalid']) {
    const { states } = fixture(t); const state = states.a;
    const review = propose(state); const item = state.repository.getReviewItem(review.reviewItemId);
    const currentId = item.metadata.expectedClaimId;
    if (change === 'value') state.db.prepare('UPDATE claims SET value_json = ? WHERE id = ?').run(JSON.stringify('changed@example.invalid'), currentId);
    if (change === 'missing') state.db.prepare('UPDATE claims SET superseded_by_claim_id = ? WHERE id = ?').run(currentId, currentId);
    if (change === 'ambiguous') state.repository.createClaim({ personId: state.config.personId, claimTypeKey: F.email, value: 'ambiguous@example.invalid', status: 'confirmed' });
    if (change === 'expired') state.db.prepare('UPDATE claims SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', currentId);
    if (change === 'future' || change === 'invalid') state.db.prepare('UPDATE claims SET updated_at = ? WHERE id = ?')
      .run(change === 'future' ? '2999-01-01T00:00:00.000Z' : 'not-a-date', currentId);
    assert.equal(isReviewStale(state, item), true, change);
    const before = factsAndGrants(state);
    assert.throws(() => approveReview(state, { ...review, expectedValue: V.nextEmail, confirmed: true }), /Confirmed data changed/, change);
    assert.equal(closeStaleReview(state, { ...review, confirmed: true }).status, 'superseded', change);
    assert.deepEqual(factsAndGrants(state), before, change);
  }
});

test('an operator can reject after revocation without renewing or widening access', (t) => {
  const { states } = fixture(t); const state = states.a;
  const review = propose(state);
  revoke(state, true);
  const before = factsAndGrants(state);
  assert.equal(isReviewStale(state, state.repository.getReviewItem(review.reviewItemId)), false);
  assert.equal(rejectReview(state, rejectArgs(review)).status, 'dismissed');
  assert.deepEqual(factsAndGrants(state), before);
  assert.throws(() => createScopedHost(state.repository, state.config).read([F.email]), /access denied/);
});

test('audit failures roll back rejection and stale closure including decision and bundle state', (t) => {
  for (const [operation, eventType] of [[rejectReview, 'mcp.operator.rejected'], [closeStaleReview, 'mcp.operator.closed-stale']]) {
    const { states } = fixture(t); const state = states.a;
    const review = propose(state);
    if (operation === closeStaleReview) {
      const other = propose(state, 'newer@example.invalid');
      approveReview(state, { ...other, expectedValue: other.suggestedValue, confirmed: true });
    }
    state.db.exec(`CREATE TRIGGER fail_resolution_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = '${eventType}' BEGIN SELECT RAISE(ABORT, 'resolution audit failure'); END;`);
    const before = allRecords(state);
    assert.throws(() => operation(state, rejectArgs(review)), /resolution audit failure/);
    assert.deepEqual(allRecords(state), before);
    state.db.exec('DROP TRIGGER fail_resolution_audit');
    operation(state, rejectArgs(review));
    assert.equal(state.repository.listReviewDecisionsForItem(review.reviewItemId).length, 1);
  }
});

test('operator CLI resolves exact reviews and rejects incomplete arguments', (t) => {
  const { states, manifest } = fixture(t); const state = states.a;
  const first = propose(state);
  const rejected = spawnSync(process.execPath, [admin, 'reject', manifest.assistants.a.configPath,
    first.reviewItemId, first.expectedVersion, 'Not my current address', '--confirm'], { encoding: 'utf8' });
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).status, 'dismissed');
  const second = propose(state);
  const other = propose(state, 'newer@example.invalid');
  approveReview(state, { ...other, expectedValue: other.suggestedValue, confirmed: true });
  const before = allRecords(state);
  const incomplete = spawnSync(process.execPath, [admin, 'close-stale', manifest.assistants.a.configPath,
    second.reviewItemId, second.expectedVersion], { encoding: 'utf8' });
  assert.equal(incomplete.status, 1);
  assert.deepEqual(allRecords(state), before);
  const closed = spawnSync(process.execPath, [admin, 'close-stale', manifest.assistants.a.configPath,
    second.reviewItemId, second.expectedVersion, '--confirm'], { encoding: 'utf8' });
  assert.equal(closed.status, 0, closed.stderr);
  assert.equal(JSON.parse(closed.stdout).status, 'superseded');
  assert.deepEqual(listReviews(state), []);
});

test('operator functions can be imported from a Node stdin script without invoking the CLI', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], { encoding: 'utf8',
    input: `import { rejectReview, closeStaleReview } from ${JSON.stringify(pathToFileURL(admin).href)};\nconsole.log(typeof rejectReview, typeof closeStaleReview);\n` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function function');
});
