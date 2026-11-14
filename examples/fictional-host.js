import { randomUUID } from 'node:crypto';
import { openCoreDatabase, closeCoreDatabase } from '../mio-core/src/db.js';
import { createCoreRepository } from '../mio-core/src/repository.js';
import { importExecutionReviewBundle } from '../mio-core/src/importers.js';
import { readScopedClaims } from './scoped-reader.js';

export const FIELDS = Object.freeze({
  firstName: 'person.name.first',
  lastName: 'person.name.last',
  email: 'person.contact.email',
});

// All names and data in this module are fictional. example.invalid cannot receive
// mail. This in-memory host sends no network requests and writes no database file.
export function createFictionalDemo({ clock = Date.now } = {}) {
  function clockNow() {
    const value = clock();
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
      throw new Error('Demo clock must return a valid timestamp in milliseconds');
    }
    return value;
  }
  const startedAt = clockNow();
  const db = openCoreDatabase({ filePath: ':memory:' });
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  const timestamp = new Date(startedAt).toISOString();
  const earlier = new Date(startedAt - 60_000).toISOString();
  const person = repository.createPerson({ id: 'person_fictional_alex', displayName: 'Alex Rowan (fictional)',
    createdAt: timestamp });
  const ownerActorId = 'fictional-local-user';
  const claims = Object.fromEntries([
    [FIELDS.firstName, 'Alex'],
    [FIELDS.lastName, 'Rowan'],
    [FIELDS.email, 'alex.old@example.invalid'],
  ].map(([claimTypeKey, value]) => [claimTypeKey, repository.createClaim({
    personId: person.id, claimTypeKey, value, status: 'confirmed',
    issuer: 'fictional-user-fixture', observedAt: earlier, createdAt: earlier,
  })]));

  // Private host context exists to make accidental broad disclosure testable.
  repository.createEvidence({
    personId: person.id, kind: 'document', storageUri: 'memory://fictional-private-note',
    mimeType: 'text/plain', sourceSystem: 'fictional-fixture',
    sourceName: 'Fictional private note that assistants must not receive',
    metadata: { content: 'PRIVATE_HOST_CONTEXT_DO_NOT_DISCLOSE' }, createdAt: timestamp,
  });

  const requesters = Object.fromEntries(['document', 'contact'].map((name) => [name,
    repository.createRequester({ name: `Mock ${name} assistant`, origin: 'local-demo',
      publicKeyOrIdentifier: `mock-${name}-assistant`, createdAt: timestamp }),
  ]));

  function grantFor(requester, claimList, grantedAt = clockNow()) {
    const grantTimestamp = new Date(grantedAt).toISOString();
    const grant = repository.createGrant({
      personId: person.id, requesterId: requester.id,
      purpose: `Fictional demonstration for ${requester.name}`,
      status: 'active', grantedAt: grantTimestamp,
      expiresAt: new Date(grantedAt + 3_600_000).toISOString(), createdAt: grantTimestamp,
      scope: { allowedFields: claimList.map((claim) => claim.claimTypeKey) },
      actions: ['read-granted-fields'],
    });
    for (const claim of claimList) {
      repository.attachGrantClaim({ grantId: grant.id, claimId: claim.id, accessMode: 'read' });
    }
    repository.createAuditEvent({
      personId: person.id, actorType: 'user', actorId: ownerActorId,
      eventType: 'demo.grant.created', eventPayload: { grantId: grant.id, requesterId: requester.id },
      createdAt: grantTimestamp,
    });
    return grant;
  }

  const grants = {
    document: grantFor(requesters.document, [claims[FIELDS.firstName], claims[FIELDS.lastName]]),
    contact: grantFor(requesters.contact, [claims[FIELDS.firstName], claims[FIELDS.email]]),
  };

  function readFor(name, requestedFields) {
    return readScopedClaims(repository, {
      personId: person.id, requesterId: requesters[name].id,
      grantId: grants[name].id, requestedFields, now: clockNow(),
    });
  }

  // These stand-ins only receive host-scoped capabilities, never the repository.
  const assistants = {
    document: {
      read: () => readFor('document', [FIELDS.firstName, FIELDS.lastName]),
      draft: () => {
        const { fields } = readFor('document', [FIELDS.firstName, FIELDS.lastName]);
        return `Draft introduction: Hello, I am ${fields[FIELDS.firstName]} ${fields[FIELDS.lastName]}.`;
      },
    },
    contact: {
      read: () => readFor('contact', [FIELDS.firstName, FIELDS.email]),
      proposeEmail: (value = 'alex.new@example.invalid') => {
        readFor('contact', [FIELDS.email]); // Current grant must still be usable.
        if (typeof value !== 'string' || !/^[a-z0-9._+-]+@example\.invalid$/i.test(value)) {
          throw new Error('This demo accepts only fictional example.invalid email addresses.');
        }
        const result = importExecutionReviewBundle(repository, {
          personId: person.id,
          reviewBundle: {
            schemaVersion: 'mio.review.bundle.v1', reviewBundleId: `demo-review-${randomUUID()}`,
            createdAt: new Date(clockNow()).toISOString(),
            source: { producer: 'mock-contact-assistant', pageStage: 'contact-update',
              pageStageLabel: 'Fictional contact update' },
            proposals: [{ field: 'email', value,
              rationale: 'Fictional suggestion from a mock assistant; requires simulated user confirmation.' }],
          },
        });
        return { reviewItemId: result.items[0].id, status: result.items[0].status };
      },
    },
  };

  // This is a SIMULATED trusted user action, not cryptographic authentication.
  // The importer records proposals; it does not promote accepted facts by itself.
  // This example explicitly composes existing repository APIs into one transaction.
  function approveEmailChange({ actorId, reviewItemId, confirmedValue, confirmed = false } = {}) {
    if (actorId !== ownerActorId || confirmed !== true) throw new Error('Explicit simulated user confirmation required');
    const item = repository.getReviewItem(reviewItemId);
    if (!item || item.personId !== person.id || item.fieldKey !== 'email' ||
        item.target !== 'identity_claim' || item.status !== 'pending' ||
        item.suggestedValue !== confirmedValue) throw new Error('Review confirmation does not match a pending proposal');
    const current = repository.getLatestClaimForType(person.id, FIELDS.email, ['confirmed']);
    if (current?.value !== item.currentValue) throw new Error('Current value changed; review the new conflict first');
    const confirmedAt = new Date(clockNow()).toISOString();

    return repository.importWithinTransaction(() => {
      const claim = repository.createClaim({
        personId: person.id, claimTypeKey: FIELDS.email, value: confirmedValue,
        status: 'confirmed', issuer: ownerActorId, observedAt: confirmedAt, createdAt: confirmedAt,
      });
      const decision = repository.createReviewDecision({
        reviewItemId: item.id, bundleId: item.bundleId, personId: person.id,
        decision: 'accepted', actorType: 'user', actorId, appliedClaimId: claim.id,
        note: 'Explicit confirmation simulated by the local example host.', createdAt: confirmedAt,
      });
      repository.resolveReviewItem({
        reviewItemId: item.id, status: 'applied', resolvedAt: confirmedAt,
        resolvedByActorType: 'user', resolvedByActorId: actorId, appliedClaimId: claim.id,
        resolutionNote: decision.note,
      });
      repository.createAuditEvent({
        personId: person.id, actorType: 'user', actorId,
        eventType: 'demo.claim.confirmed',
        eventPayload: { reviewItemId: item.id, decisionId: decision.id, claimId: claim.id },
        createdAt: confirmedAt,
      });
      return claim;
    });
  }

  function authorizeNewEmail({ actorId, claimId, confirmed = false } = {}) {
    if (actorId !== ownerActorId || confirmed !== true) throw new Error('Explicit simulated sharing confirmation required');
    const claim = repository.getLatestClaimForType(person.id, FIELDS.email, ['confirmed']);
    if (!claim || claim.id !== claimId || claim.issuer !== ownerActorId) throw new Error('Expected a user-confirmed email claim');
    const authorizedAt = clockNow();
    const newGrant = repository.importWithinTransaction(() => {
      repository.revokeGrant(grants.contact.id, new Date(authorizedAt).toISOString());
      return grantFor(requesters.contact, [claims[FIELDS.firstName], claim], authorizedAt);
    });
    // Publish the handle only after revocation, new grant, links, and audit commit.
    grants.contact = newGrant;
    return newGrant;
  }

  // Host-only handles are exposed for tests and the command-line narrator.
  // A real assistant integration must receive only its capability object above.
  return { repository, person, ownerActorId, claims, requesters, grants, assistants,
    approveEmailChange, authorizeNewEmail, close: () => closeCoreDatabase(db) };
}
