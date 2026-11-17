import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeSharedProfile, openSharedProfile, SHARED_PROFILE_FIELDS as F } from '../examples/shared-profile/fixture.js';
import { startReviewServer, operatorSnapshot } from '../examples/shared-profile/server.js';
import { prepareFormDraft, listFormDrafts } from '../examples/shared-profile/scenarios.js';

const source = { kind: 'user-stated', reference: 'Alex’s fictional travel intake', locator: 'Employment section' };
const values = { [F.employer]: 'Example Research Ltd', [F.jobTitle]: 'Research engineer' };
const travel = { assistantId: 'a', scenarioId: 'travel', taskValues: { destination: 'Example City', purpose: 'Research visit' } };
const onboarding = { assistantId: 'b', scenarioId: 'onboarding', taskValues: { startDate: '2027-01-15', department: 'Example Research' } };
const entry = (draft, inputKey) => draft.fields.find((field) => field.inputKey === inputKey);

async function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mio-identity-scenes-')));
  const directory = path.join(parent, 'profile');
  initializeSharedProfile(directory);
  const local = openSharedProfile(directory);
  const running = await startReviewServer({ directory });
  t.after(async () => { await running.close(); local.close(); fs.rmSync(parent, { recursive: true, force: true }); });
  const request = async (route = '/api/state', data) => {
    const response = await fetch(running.origin + route, { method: data ? 'POST' : 'GET',
      headers: { 'X-Mio-Token': running.token, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const collect = async (field, value = values[field]) => {
    const response = await request('/api/collect', { assistantId: 'a', field, value,
      rationale: 'Reusable employment information supplied in this fictional intake.', source });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const approve = async (field) => {
    const review = (await request()).data.reviews.find((item) => item.field === field);
    const result = await request('/api/approve', { assistantId: 'a', reviewItemId: review.reviewItemId,
      expectedVersion: review.expectedVersion, expectedValue: review.suggestedValue, confirmed: true });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  const share = async (assistantId, field, claimId) => {
    const result = await request('/api/share', { assistantId, field, claimId, confirmed: true });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  };
  return { ...running, local, directory, request, collect, approve, share };
}

test('travel collects missing facts; review and separate shares enable exact-version reuse in onboarding', async (t) => {
  const f = await fixture(t);
  const before = (await f.request()).data;
  assert.equal(before.scenarios.length, 2);
  assert.equal(before.scenarios.every((scene) => scene.active), true);
  assert.ok(before.scenarios.every((scene) => scene.fields.filter((field) => field.collectible).length === 2));
  assert.ok(before.claims.every((claim) => !Object.hasOwn(values, claim.field)));
  const missing = (await f.request('/api/draft', travel)).data;
  assert.deepEqual(missing.missing.map((field) => field.inputKey), ['employerName', 'occupation']);
  for (const field of Object.keys(values)) await f.collect(field);
  const pending = (await f.request()).data;
  assert.equal(pending.reviews.length, 2);
  assert.ok(pending.reviews.every((review) => review.proposalKind === 'new-fact' && review.stale === false));
  assert.deepEqual(pending.reviews[0].source, source);
  assert.deepEqual(pending.claims, before.claims);
  assert.equal((await f.request('/api/draft', travel)).data.missing.length, 2);
  const approved = {};
  for (const field of Object.keys(values)) {
    approved[field] = await f.approve(field);
    assert.equal(approved[field].shared, false);
  }
  assert.equal((await f.request('/api/draft', travel)).data.missing.length, 2);
  assert.equal((await f.request('/api/draft', onboarding)).data.missing.length, 2);
  for (const field of Object.keys(values)) await f.share('a', field, approved[field].claimId);
  const travelDraft = (await f.request('/api/draft', travel)).data;
  assert.deepEqual(travelDraft.missing, []);
  assert.equal(travelDraft.submitted, false);
  assert.equal(travelDraft.recipient, 'Example Travel Desk');
  assert.equal((await f.request('/api/draft', onboarding)).data.missing.length, 2);
  for (const field of Object.keys(values)) await f.share('b', field, approved[field].claimId);
  const onboardingDraft = (await f.request('/api/draft', onboarding)).data;
  assert.deepEqual(onboardingDraft.missing, []);
  for (const [leftKey, rightKey, field] of [['employerName', 'organization', F.employer], ['occupation', 'position', F.jobTitle]]) {
    const left = entry(travelDraft, leftKey); const right = entry(onboardingDraft, rightKey);
    assert.equal(left.value, values[field]); assert.equal(right.value, left.value);
    assert.equal(left.claimId, approved[field].claimId); assert.equal(left.claimId, right.claimId);
    assert.deepEqual(left.source, right.source);
    assert.equal(left.source.reference, source.reference); assert.equal(left.source.verified, false);
  }
  const raw = JSON.stringify([travelDraft, onboardingDraft]);
  assert.doesNotMatch(raw, /FICTIONAL_PRIVATE|grantId|requesterId|\.sqlite/);
  assert.equal(entry(travelDraft, 'destination').origin, 'task');
  assert.equal(entry(onboardingDraft, 'startDate').origin, 'task');
  const identityValues = f.local.states.a.repository.listClaimsForPerson(f.local.manifest.personId).map((claim) => claim.value);
  for (const value of [...Object.values(travel.taskValues), ...Object.values(onboarding.taskValues)]) assert.ok(!identityValues.includes(value));
  const reopened = openSharedProfile(f.directory);
  try { assert.deepEqual(listFormDrafts(reopened)[0], onboardingDraft); }
  finally { reopened.close(); }
});

test('draft snapshots remain unchanged after a correction and revocation; future drafts use only shared versions', async (t) => {
  const f = await fixture(t);
  await f.collect(F.employer); const original = await f.approve(F.employer);
  await f.share('a', F.employer, original.claimId); await f.share('b', F.employer, original.claimId);
  const oldDraft = (await f.request('/api/draft', onboarding)).data;
  const proposal = await f.request('/api/propose', { assistantId: 'a', field: F.employer,
    value: 'Example New Employer', rationale: 'A later fictional employment change.' });
  assert.equal(proposal.status, 200);
  const current = await f.approve(F.employer);
  const unshared = (await f.request('/api/draft', onboarding)).data;
  assert.ok(unshared.missing.some((field) => field.inputKey === 'organization'));
  await f.share('b', F.employer, current.claimId);
  const next = (await f.request('/api/draft', onboarding)).data;
  assert.equal(entry(next, 'organization').value, 'Example New Employer');
  assert.notEqual(entry(next, 'organization').claimId, entry(oldDraft, 'organization').claimId);
  assert.equal((await f.request('/api/revoke', { assistantId: 'b', confirmed: true })).status, 200);
  assert.equal((await f.request('/api/draft', onboarding)).status, 403);
  const saved = (await f.request()).data.drafts.find((draft) => draft.id === oldDraft.id);
  assert.deepEqual(saved, oldDraft);
});

test('draft action checks scenario binding, input semantics, grant expiry, and protects against identity overrides', async (t) => {
  const f = await fixture(t);
  for (const payload of [
    { ...travel, taskValues: { ...travel.taskValues, employerName: 'Injected' } },
    { ...travel, taskValues: { destination: '' } },
    { ...onboarding, taskValues: { startDate: '2027-02-30', department: 'Example' } },
    { ...travel, recipient: 'Attacker' },
  ]) assert.equal((await f.request('/api/draft', payload)).status, 400);
  assert.equal((await f.request('/api/draft', { ...travel, assistantId: 'b' })).status, 403);
  const state = f.local.states.a;
  const grant = state.repository.listGrantsForPerson(state.config.personId).find((entry) => entry.id === state.config.grantId);
  const restore = () => state.db.prepare('UPDATE grants SET actions_json = ?, scope_json = ?, expires_at = ? WHERE id = ?')
    .run(JSON.stringify(grant.actions), JSON.stringify(grant.scope), grant.expiresAt, grant.id);
  for (const actions of [grant.actions.filter((action) => action !== 'prepare-form-draft'), grant.actions.filter((action) => action !== 'read-granted-fields')]) {
    state.db.prepare('UPDATE grants SET actions_json = ? WHERE id = ?').run(JSON.stringify(actions), grant.id);
    assert.equal((await f.request('/api/draft', travel)).status, 403); restore();
  }
  state.db.prepare('UPDATE grants SET scope_json = ? WHERE id = ?').run(JSON.stringify({ ...grant.scope, scenarioIds: ['onboarding'] }), grant.id);
  assert.equal((await f.request('/api/draft', travel)).status, 403); restore();
  state.db.prepare('UPDATE grants SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00Z', grant.id);
  assert.equal((await f.request('/api/draft', travel)).status, 403); restore();
  assert.deepEqual(listFormDrafts(f.local), []);
});

test('draft audit failure rolls back the saved form and polling creates no assistant operations', async (t) => {
  const f = await fixture(t);
  const initial = operatorSnapshot(f.local);
  assert.deepEqual(operatorSnapshot(f.local), initial);
  // A database-level trigger affects the independent HTTP connection as well.
  f.local.states.a.db.exec(`CREATE TRIGGER fail_draft_audit BEFORE INSERT ON audit_events
    WHEN NEW.event_type = 'demo.form.drafted' BEGIN SELECT RAISE(ABORT, 'private failure'); END`);
  const result = await f.request('/api/draft', travel);
  assert.equal(result.status, 500); assert.doesNotMatch(JSON.stringify(result.data), /private failure|\.sqlite/);
  assert.deepEqual(listFormDrafts(f.local), []);
  assert.deepEqual(operatorSnapshot(f.local).audit, initial.audit);
});

test('collection HTTP validates sources and never turns task fields into identity facts', async (t) => {
  const f = await fixture(t);
  const base = { assistantId: 'a', field: F.employer, value: 'Example Ltd', rationale: 'Fictional intake', source };
  for (const payload of [{ ...base, source: { ...source, verified: true } }, { ...base, source: { kind: 'user-stated', reference: ' ' } },
    { ...base, value: ' ' }, { ...base, approved: true }]) assert.equal((await f.request('/api/collect', payload)).status, 400);
  for (const field of ['destination', 'purpose', 'startDate', 'department', F.passport, F.email]) {
    assert.equal((await f.request('/api/collect', { ...base, field })).status, 403);
  }
  const first = await f.request('/api/collect', base);
  const duplicate = await f.request('/api/collect', base);
  assert.equal(first.status, 200); assert.equal(duplicate.status, 200);
  assert.equal(first.data.reviewItemId, duplicate.data.reviewItemId);
  assert.equal((await f.request()).data.reviews.length, 1);
});

test('legacy v1 profiles reopen without new collection or draft permissions and without database migration', (t) => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mio-identity-legacy-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'profile');
  const initialized = initializeSharedProfile(directory);
  const original = openSharedProfile(directory);
  const legacy = { a: { fields: [F.firstName, F.email], actions: ['read-granted-fields', 'propose-update'] },
    b: { fields: [F.firstName, F.address], actions: ['read-granted-fields'] } };
  const manifest = JSON.parse(fs.readFileSync(initialized.manifestPath, 'utf8'));
  manifest.schemaVersion = 'mio.shared-profile-demo.v1';
  for (const id of ['a', 'b']) {
    manifest.assistants[id].fields = legacy[id].fields;
    original.states[id].db.prepare('UPDATE grants SET actions_json = ?, scope_json = ? WHERE id = ?')
      .run(JSON.stringify(legacy[id].actions), JSON.stringify({ allowedFields: legacy[id].fields }), original.states[id].config.grantId);
  }
  original.states.a.db.exec('DROP TABLE demo_form_drafts');
  const before = original.states.a.repository.listGrantsForPerson(manifest.personId);
  original.close();
  fs.writeFileSync(initialized.manifestPath, JSON.stringify(manifest));
  const reopened = openSharedProfile(directory);
  try {
    assert.deepEqual(operatorSnapshot(reopened).scenarios, []);
    assert.deepEqual(listFormDrafts(reopened), []);
    assert.deepEqual(reopened.states.a.repository.listGrantsForPerson(manifest.personId), before);
    assert.throws(() => prepareFormDraft(reopened, travel), /access denied/);
    assert.equal(reopened.states.a.db.prepare("SELECT name FROM sqlite_master WHERE name='demo_form_drafts'").get(), undefined);
  } finally { reopened.close(); }
});
