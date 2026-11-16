import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { initializeSharedProfile, openSharedProfile, SHARED_PROFILE_FIELDS as F, SHARED_PROFILE_VALUES as V } from '../examples/shared-profile/fixture.js';
import { startReviewServer } from '../examples/shared-profile/server.js';

async function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-review-http-'));
  const directory = path.join(parent, 'profile');
  initializeSharedProfile(directory);
  const running = await startReviewServer({ directory });
  t.after(async () => { await running.close(); fs.rmSync(parent, { recursive: true, force: true }); });
  const request = async (route = '/api/state', payload, options = {}) => {
    const response = await fetch(`${running.origin}${route}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'X-Mio-Token': running.token, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), ...options,
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  return { ...running, directory, request };
}
const assistant = (snapshot, id) => snapshot.assistants.find((item) => item.id === id);
const field = (snapshot, id, key) => assistant(snapshot, id).fields.find((item) => item.field === key);
const proposal = { assistantId: 'a', field: F.email, value: V.nextEmail, rationale: 'Fictional address change for review' };

test('operator page protects every API read and write, prevents foreign origins/hosts, and serves no token in HTML', async (t) => {
  const f = await fixture(t);
  const page = await fetch(f.origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.doesNotMatch(await page.text(), new RegExp(f.token));
  for (const route of ['/api/state', '/api/propose']) {
    const result = await fetch(f.origin + route, { method: route.endsWith('state') ? 'GET' : 'POST',
      ...(route.endsWith('state') ? {} : { body: JSON.stringify(proposal), headers: { 'Content-Type': 'application/json' } }) });
    assert.equal(result.status, 401);
  }
  const foreign = await fetch(f.origin + '/api/state', { headers: { 'X-Mio-Token': f.token, Origin: 'https://foreign.invalid' } });
  assert.equal(foreign.status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.get(f.origin + '/api/state', { headers: { Host: 'foreign.invalid', 'X-Mio-Token': f.token } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(f.origin + '/api/state', { headers: { 'X-Mio-Token': f.token, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(f.origin + '/api/state', { headers: { 'X-Mio-Token': 'wrong' } })).status, 401);
});

test('operator snapshots do not emit assistant audit events or include hidden facts', async (t) => {
  const f = await fixture(t);
  const first = await f.request(); const second = await f.request();
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.audit, second.data.audit);
  assert.doesNotMatch(JSON.stringify(first.data), /FICTIONAL_PRIVATE_DO_NOT_DISCLOSE|passport.number/);
  assert.equal(field(first.data, 'a', F.email).value, V.email);
  assert.equal(field(first.data, 'b', F.address).value, V.address);
  assert.equal(field(first.data, 'b', F.email), undefined);
});

test('HTTP walkthrough separates proposal, exact approval, sharing, and per-assistant revocation', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/propose', proposal)).data.status, 'pending');
  let snapshot = (await f.request()).data;
  assert.equal(field(snapshot, 'a', F.email).value, V.email);
  const [review] = snapshot.reviews;
  const approval = { assistantId: 'a', reviewItemId: review.reviewItemId, expectedVersion: review.expectedVersion, expectedValue: V.nextEmail, confirmed: true };
  assert.equal((await f.request('/api/approve', { ...approval, confirmed: false })).status, 400);
  assert.equal((await f.request('/api/approve', { ...approval, assistantId: 'b' })).status, 409);
  assert.equal((await f.request('/api/approve', { ...approval, expectedVersion: 'stale' })).status, 409);
  const approved = await f.request('/api/approve', approval);
  assert.equal(approved.status, 200); assert.equal(approved.data.shared, false);
  snapshot = (await f.request()).data;
  assert.equal(snapshot.reviews.length, 0);
  assert.equal(field(snapshot, 'a', F.email).state, 'unshared');
  assert.equal(Object.hasOwn(field(snapshot, 'a', F.email), 'value'), false);
  assert.equal(snapshot.claims.find((item) => item.field === F.email).value, V.nextEmail);
  assert.equal(field(snapshot, 'b', F.address).value, V.address);
  assert.equal((await f.request('/api/approve', approval)).status, 409);
  const sharing = { assistantId: 'a', field: F.email, claimId: approved.data.claimId, confirmed: true };
  assert.equal((await f.request('/api/share', { ...sharing, assistantId: 'b' })).status, 409);
  assert.equal((await f.request('/api/share', { ...sharing, grantId: 'override' })).status, 400);
  assert.equal((await f.request('/api/share', sharing)).status, 200);
  snapshot = (await f.request()).data;
  assert.equal(field(snapshot, 'a', F.email).value, V.nextEmail);
  assert.equal((await f.request('/api/revoke', { assistantId: 'a' })).status, 400);
  assert.equal((await f.request('/api/revoke', { assistantId: 'a', confirmed: true })).status, 200);
  snapshot = (await f.request()).data;
  assert.equal(assistant(snapshot, 'a').status, 'revoked');
  assert.ok(assistant(snapshot, 'a').fields.every((item) => item.state === 'unavailable' && !Object.hasOwn(item, 'value')));
  assert.equal(field(snapshot, 'b', F.address).value, V.address);
  assert.equal((await f.request('/api/propose', proposal)).status, 403);
});

test('operator API rejects unavailable proposals, extra keys, invalid bodies and unsafe methods', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/propose', { ...proposal, assistantId: 'b', field: F.address })).status, 403);
  assert.equal((await f.request('/api/propose', { ...proposal, field: F.passport })).status, 403);
  assert.equal((await f.request('/api/propose', { ...proposal, requesterId: 'other' })).status, 400);
  assert.equal((await f.request('/api/approve')).status, 405);
  assert.equal((await fetch(f.origin + '/api/propose', { method: 'POST', headers: { 'X-Mio-Token': f.token }, body: JSON.stringify(proposal) })).status, 415);
  assert.equal((await fetch(f.origin + '/api/propose', { method: 'POST', headers: { 'X-Mio-Token': f.token, 'Content-Type': 'application/json' }, body: 'not-json' })).status, 400);
  assert.equal((await fetch(f.origin + '/api/propose', { method: 'POST', headers: { 'X-Mio-Token': f.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...proposal, rationale: 'x'.repeat(20_000) }) })).status, 413);
  assert.equal((await f.request()).data.reviews.length, 0);
});

test('failed approval audit rolls back facts and review; HTTP exposes no database diagnostic', async (t) => {
  const f = await fixture(t);
  await f.request('/api/propose', proposal);
  const [review] = (await f.request()).data.reviews;
  const local = openSharedProfile(f.directory);
  try {
    local.states.a.db.exec("CREATE TRIGGER fail_http_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'mcp.operator.approved' BEGIN SELECT RAISE(ABORT, 'PRIVATE_DATABASE_DIAGNOSTIC'); END;");
    const result = await f.request('/api/approve', { assistantId: 'a', reviewItemId: review.reviewItemId, expectedVersion: review.expectedVersion, expectedValue: V.nextEmail, confirmed: true });
    assert.equal(result.status, 500);
    assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE_DATABASE|SQL|sqlite/);
    const snapshot = (await f.request()).data;
    assert.equal(snapshot.reviews.length, 1);
    assert.equal(field(snapshot, 'a', F.email).value, V.email);
    assert.equal(snapshot.claims.find((item) => item.field === F.email).value, V.email);
  } finally { local.close(); }
});

test('operator view flags obsolete proposals and uses the same latest-value selector as MCP', async (t) => {
  const f = await fixture(t);
  await f.request('/api/propose', proposal);
  await f.request('/api/propose', { ...proposal, value: 'alex.other@example.invalid' });
  let snapshot = (await f.request()).data;
  assert.ok(snapshot.reviews.every((review) => review.stale === false));
  const review = snapshot.reviews.find((item) => item.suggestedValue === V.nextEmail);
  await f.request('/api/approve', { assistantId: 'a', reviewItemId: review.reviewItemId, expectedVersion: review.expectedVersion, expectedValue: V.nextEmail, confirmed: true });
  snapshot = (await f.request()).data;
  assert.equal(snapshot.reviews.length, 1);
  assert.equal(snapshot.reviews[0].stale, true);
  const local = openSharedProfile(f.directory);
  try {
    // A legacy import can retain an older unsuperseded candidate. Match the
    // MCP selection policy rather than falsely hiding the usable latest value.
    local.states.a.repository.createClaim({ personId: local.manifest.personId, claimTypeKey: F.email,
      value: 'legacy@example.invalid', status: 'confirmed', createdAt: '2020-01-01T00:00:00.000Z' });
    snapshot = (await f.request()).data;
    assert.equal(snapshot.claims.find((item) => item.field === F.email).value, V.nextEmail);
    assert.equal(field(snapshot, 'a', F.email).state, 'unshared');
  } finally { local.close(); }
});
