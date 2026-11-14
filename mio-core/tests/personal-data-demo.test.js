import test from 'node:test';
import assert from 'node:assert/strict';
import { createFictionalDemo, FIELDS } from '../../examples/fictional-host.js';
import { DemoAccessDenied, readScopedClaims } from '../../examples/scoped-reader.js';

const NOW = Date.parse('2030-01-02T12:00:00.000Z');

function fixture(t, clock = () => NOW) {
  const demo = createFictionalDemo({ clock });
  t.after(demo.close);
  return demo;
}

function request(demo, overrides = {}) {
  return {
    personId: demo.person.id, requesterId: demo.requesters.contact.id,
    grantId: demo.grants.contact.id, requestedFields: [FIELDS.email], now: NOW,
    ...overrides,
  };
}

function makeGrant(demo, { grant = {}, claim = demo.claims[FIELDS.email], mode = 'read' } = {}) {
  const result = demo.repository.createGrant({
    personId: demo.person.id, requesterId: demo.requesters.contact.id,
    purpose: 'Fictional authorization test', status: 'active',
    grantedAt: new Date(NOW - 1_000).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(),
    actions: ['read-granted-fields'], scope: { allowedFields: [FIELDS.email] }, ...grant,
  });
  if (claim) demo.repository.attachGrantClaim({ grantId: result.id, claimId: claim.id, accessMode: mode });
  return result;
}

test('two mock assistants share a fact but receive only their requested authorized field values', (t) => {
  const demo = fixture(t);
  assert.deepEqual(demo.assistants.document.read(), {
    fields: { [FIELDS.firstName]: 'Alex', [FIELDS.lastName]: 'Rowan' },
  });
  assert.deepEqual(demo.assistants.contact.read(), {
    fields: { [FIELDS.firstName]: 'Alex', [FIELDS.email]: 'alex.old@example.invalid' },
  });
  assert.deepEqual(readScopedClaims(demo.repository, request(demo)), {
    fields: { [FIELDS.email]: 'alex.old@example.invalid' },
  });
  assert.ok(demo.repository.listEvidenceForPerson(demo.person.id).length > 0);
  const proposal = demo.assistants.contact.proposeEmail();
  assert.ok(demo.repository.getReviewItem(proposal.reviewItemId));
  const exported = JSON.stringify(demo.assistants.contact.read());
  assert.ok(!exported.includes('PRIVATE_HOST_CONTEXT_DO_NOT_DISCLOSE'));
  assert.ok(!exported.includes('alex.new@example.invalid'));
  assert.ok(!exported.includes('evidence') && !exported.includes('review'));
  assert.throws(() => readScopedClaims(demo.repository, request(demo, {
    grantId: demo.grants.document.id, requesterId: demo.requesters.document.id,
  })), DemoAccessDenied);
});

test('person, requester, and grant bindings are all enforced, including a cross-person claim attachment', (t) => {
  const demo = fixture(t);
  for (const overrides of [
    { personId: 'missing-person' }, { requesterId: demo.requesters.document.id },
    { grantId: 'missing-grant' },
  ]) assert.throws(() => readScopedClaims(demo.repository, request(demo, overrides)), DemoAccessDenied);

  const other = demo.repository.createPerson({ displayName: 'Another fictional person' });
  const otherEmail = demo.repository.createClaim({ personId: other.id, claimTypeKey: FIELDS.email,
    value: 'other@example.invalid', status: 'confirmed' });
  assert.throws(() => readScopedClaims(demo.repository, request(demo, { personId: other.id })), DemoAccessDenied);
  const crossAttached = makeGrant(demo, { claim: otherEmail });
  assert.throws(() => readScopedClaims(demo.repository, request(demo, { grantId: crossAttached.id })), DemoAccessDenied);
});

test('inactive, expired, revoked, future, and malformed grants fail closed', (t) => {
  const demo = fixture(t);
  for (const change of [
    ...['proposed', 'expired', 'revoked', 'denied'].map((status) => ({ status })),
    { expiresAt: new Date(NOW).toISOString() }, { expiresAt: 'invalid' },
    { revokedAt: new Date(NOW - 1).toISOString() },
    { grantedAt: new Date(NOW + 1).toISOString() }, { grantedAt: null },
    { grantedAt: 'invalid' }, { actions: [] }, { scope: {} },
  ]) {
    const grant = makeGrant(demo, { grant: change });
    assert.throws(() => readScopedClaims(demo.repository, request(demo, { grantId: grant.id })), DemoAccessDenied);
  }
  demo.repository.revokeGrant(demo.grants.contact.id);
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
});

test('allowedFields, exact attached claim, and read access mode are independently required', (t) => {
  const demo = fixture(t);
  for (const options of [
    { grant: { scope: { allowedFields: [] } } }, { claim: null },
    { mode: 'verify_only' }, { mode: 'autofill' },
  ]) {
    const grant = makeGrant(demo, options);
    assert.throws(() => readScopedClaims(demo.repository, request(demo, { grantId: grant.id })), DemoAccessDenied);
  }
  assert.throws(() => readScopedClaims(demo.repository, request(demo, {
    requestedFields: [FIELDS.email, FIELDS.lastName],
  })), DemoAccessDenied);
  for (const requestedFields of [null, [], ['*'], [FIELDS.email, null]]) {
    assert.throws(() => readScopedClaims(demo.repository, request(demo, { requestedFields })), DemoAccessDenied);
  }
});

test('unconfirmed, expired, and superseded attached claims cannot be disclosed', (t) => {
  const demo = fixture(t);
  const field = 'person.contact.phone';
  for (const changes of [
    ...['asserted', 'extracted', 'verified', 'expired', 'revoked', 'superseded'].map((status) => ({ status })),
    { status: 'confirmed', expiresAt: new Date(NOW).toISOString() },
    { status: 'confirmed', expiresAt: 'invalid' },
    { status: 'confirmed', supersededByClaimId: demo.claims[FIELDS.email].id },
  ]) {
    // A separate subject prevents previous rows from supplying a fallback value.
    const person = demo.repository.createPerson({ displayName: 'Fictional claim-state fixture' });
    const claim = demo.repository.createClaim({ personId: person.id, claimTypeKey: field,
      value: 'fictional-phone', ...changes });
    const grant = makeGrant(demo, { claim, grant: { personId: person.id, scope: { allowedFields: [field] } } });
    assert.throws(() => readScopedClaims(demo.repository, request(demo, {
      personId: person.id, grantId: grant.id, requestedFields: [field],
    })), DemoAccessDenied);
  }
});

test('a proposal leaves canonical data unchanged until the matching simulated user confirms it', (t) => {
  const demo = fixture(t);
  const proposal = demo.assistants.contact.proposeEmail();
  const confirm = { actorId: demo.ownerActorId, reviewItemId: proposal.reviewItemId,
    confirmedValue: 'alex.new@example.invalid', confirmed: true };
  assert.equal(demo.repository.getReviewItem(proposal.reviewItemId).status, 'pending');
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.old@example.invalid');
  for (const changed of [
    { confirmed: false }, { actorId: demo.requesters.contact.id },
    { confirmedValue: 'different@example.invalid' }, { reviewItemId: 'missing-review' },
  ]) assert.throws(() => demo.approveEmailChange({ ...confirm, ...changed }));
  assert.equal(demo.repository.listClaimsForPerson(demo.person.id).length, 3);

  const claim = demo.approveEmailChange(confirm);
  assert.equal(demo.repository.getLatestClaimForType(demo.person.id, FIELDS.email).value, 'alex.new@example.invalid');
  const item = demo.repository.getReviewItem(proposal.reviewItemId);
  const [decision] = demo.repository.listReviewDecisionsForItem(item.id);
  assert.equal(item.status, 'applied');
  assert.equal(item.appliedClaimId, claim.id);
  assert.equal(decision.appliedClaimId, claim.id);
  assert.equal(decision.actorType, 'user');
  assert.ok(demo.repository.listAuditEventsForPerson(demo.person.id).some((event) =>
    event.eventType === 'demo.claim.confirmed' && event.eventPayload.claimId === claim.id));
  assert.throws(() => demo.approveEmailChange(confirm));
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
  assert.throws(() => demo.authorizeNewEmail({ actorId: demo.ownerActorId, claimId: claim.id, confirmed: false }));
  demo.authorizeNewEmail({ actorId: demo.ownerActorId, claimId: claim.id, confirmed: true });
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.new@example.invalid');
  assert.deepEqual(Object.keys(demo.assistants.document.read().fields), [FIELDS.firstName, FIELDS.lastName]);
});

test('an approval cannot use a review item from another person or overwrite a newer change silently', (t) => {
  const demo = fixture(t);
  const person = demo.repository.createPerson({ displayName: 'Fictional other review owner' });
  const bundle = demo.repository.createReviewBundle({ personId: person.id, sourceSystem: 'fixture' });
  const item = demo.repository.createReviewItem({ personId: person.id, bundleId: bundle.id,
    itemType: 'proposal', fieldKey: 'email', target: 'identity_claim', suggestedValue: 'other@example.invalid' });
  assert.throws(() => demo.approveEmailChange({ actorId: demo.ownerActorId, reviewItemId: item.id,
    confirmedValue: item.suggestedValue, confirmed: true }));
  const proposal = demo.assistants.contact.proposeEmail();
  demo.repository.createClaim({ personId: demo.person.id, claimTypeKey: FIELDS.email,
    value: 'newer@example.invalid', status: 'confirmed', createdAt: new Date(NOW).toISOString() });
  assert.throws(() => demo.approveEmailChange({ actorId: demo.ownerActorId, reviewItemId: proposal.reviewItemId,
    confirmedValue: 'alex.new@example.invalid', confirmed: true }), /conflict/);
  assert.equal(demo.repository.getReviewItem(proposal.reviewItemId).status, 'pending');
});

test('confirmation rolls back claim and decision together if audit recording fails', (t) => {
  const demo = fixture(t);
  const proposal = demo.assistants.contact.proposeEmail();
  const originalAudit = demo.repository.createAuditEvent;
  demo.repository.createAuditEvent = () => { throw new Error('Simulated audit failure'); };
  assert.throws(() => demo.approveEmailChange({ actorId: demo.ownerActorId,
    reviewItemId: proposal.reviewItemId, confirmedValue: 'alex.new@example.invalid', confirmed: true }), /audit failure/);
  demo.repository.createAuditEvent = originalAudit;
  assert.equal(demo.repository.listClaimsForPerson(demo.person.id).length, 3);
  assert.equal(demo.repository.getReviewItem(proposal.reviewItemId).status, 'pending');
  assert.equal(demo.repository.listReviewDecisionsForItem(proposal.reviewItemId).length, 0);
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.old@example.invalid');
});

test('assistant capabilities check the live clock, and new authorization gets a fresh lifetime', (t) => {
  let now = NOW;
  const demo = fixture(t, () => now);
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.old@example.invalid');
  now += 1_000;
  const proposal = demo.assistants.contact.proposeEmail();
  assert.equal(demo.repository.getReviewItem(proposal.reviewItemId).createdAt, new Date(now).toISOString());
  now = NOW + 3_600_000 - 1;
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.old@example.invalid');
  now += 1;
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
  assert.throws(() => demo.assistants.document.read(), DemoAccessDenied);
  assert.throws(() => demo.assistants.contact.proposeEmail(), DemoAccessDenied);

  // The host can review an existing proposal after the assistant's grant expires.
  now += 1_000;
  const claim = demo.approveEmailChange({ actorId: demo.ownerActorId, reviewItemId: proposal.reviewItemId,
    confirmedValue: 'alex.new@example.invalid', confirmed: true });
  assert.equal(claim.createdAt, new Date(now).toISOString());
  assert.equal(demo.repository.getReviewItem(proposal.reviewItemId).resolvedAt, new Date(now).toISOString());
  now += 1_000;
  const grant = demo.authorizeNewEmail({ actorId: demo.ownerActorId, claimId: claim.id, confirmed: true });
  assert.equal(grant.grantedAt, new Date(now).toISOString());
  assert.equal(grant.expiresAt, new Date(now + 3_600_000).toISOString());
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.new@example.invalid');
  assert.throws(() => demo.assistants.document.read(), DemoAccessDenied);
  now += 3_600_000;
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
});

test('failed sharing audit rolls back revocation, grant, links, and the active capability handle', (t) => {
  const demo = fixture(t);
  const proposal = demo.assistants.contact.proposeEmail();
  const claim = demo.approveEmailChange({ actorId: demo.ownerActorId, reviewItemId: proposal.reviewItemId,
    confirmedValue: 'alex.new@example.invalid', confirmed: true });
  const originalHandle = demo.grants.contact;
  const originalGrants = demo.repository.listGrantsForPerson(demo.person.id);
  const originalLinks = demo.repository.listGrantClaims(originalHandle.id);
  const originalEvents = demo.repository.listAuditEventsForPerson(demo.person.id);
  const originalAudit = demo.repository.createAuditEvent;
  demo.repository.createAuditEvent = () => { throw new Error('Simulated sharing audit failure'); };
  assert.throws(() => demo.authorizeNewEmail({ actorId: demo.ownerActorId, claimId: claim.id, confirmed: true }), /sharing audit failure/);
  demo.repository.createAuditEvent = originalAudit;

  assert.strictEqual(demo.grants.contact, originalHandle);
  assert.deepEqual(demo.repository.listGrantsForPerson(demo.person.id), originalGrants);
  assert.deepEqual(demo.repository.listGrantClaims(originalHandle.id), originalLinks);
  assert.deepEqual(demo.repository.listAuditEventsForPerson(demo.person.id), originalEvents);
  assert.equal(demo.repository.listGrantsForPerson(demo.person.id).find((grant) => grant.id === originalHandle.id).status, 'active');
  // It is still the original grant, which cannot disclose the newly confirmed claim.
  assert.throws(() => demo.assistants.contact.read(), DemoAccessDenied);
  const newGrant = demo.authorizeNewEmail({ actorId: demo.ownerActorId, claimId: claim.id, confirmed: true });
  assert.notEqual(newGrant.id, originalHandle.id);
  assert.equal(demo.assistants.contact.read().fields[FIELDS.email], 'alex.new@example.invalid');
  assert.equal(demo.repository.listGrantsForPerson(demo.person.id).find((grant) => grant.id === originalHandle.id).status, 'revoked');
});
