import { createFictionalDemo } from '../examples/fictional-host.js';
import { readScopedClaims } from '../examples/scoped-reader.js';

// Exercise the public example's real reader, review importer and SQLite-backed
// transaction path. No surrogate implementation supplies the Mio outcomes.
export function createMioHost(fixture, profileSize) {
  let now = Date.parse(fixture.now);
  const demo = createFictionalDemo({ clock: () => now });
  for (const [claimTypeKey, value] of Object.entries(fixture.fields).slice(3, profileSize)) {
    demo.repository.createClaim({ personId: demo.person.id, claimTypeKey, value,
      status: 'confirmed', issuer: 'fixture',
      observedAt: new Date(now - 60_000).toISOString(), createdAt: new Date(now - 60_000).toISOString() });
  }
  let proposal;
  let confirmed;
  function withAuditFailure(fail, operation) {
    const previous = demo.repository.createAuditEvent;
    if (fail) demo.repository.createAuditEvent = () => { throw new Error('Injected audit failure'); };
    try { return operation(); } finally { demo.repository.createAuditEvent = previous; }
  }
  return {
    read(task, overrides = {}) {
      return readScopedClaims(demo.repository, { personId: demo.person.id,
        requesterId: demo.requesters[task.assistant].id, grantId: demo.grants[task.assistant].id,
        requestedFields: task.requestedFields, now, ...overrides });
    },
    propose() {
      proposal = demo.assistants.contact.proposeEmail(fixture.newEmail);
      return proposal.status;
    },
    confirm({ failAudit = false } = {}) {
      confirmed = withAuditFailure(failAudit, () => demo.approveEmailChange({ actorId: demo.ownerActorId,
        reviewItemId: proposal.reviewItemId, confirmedValue: fixture.newEmail, confirmed: true }));
      return confirmed;
    },
    authorize({ failAudit = false } = {}) {
      return withAuditFailure(failAudit, () => demo.authorizeNewEmail({ actorId: demo.ownerActorId,
        claimId: confirmed.id, confirmed: true }));
    },
    setNow(value) { now = value; },
    revoke() { demo.repository.revokeGrant(demo.grants.contact.id, new Date(now).toISOString()); },
    state() {
      const grants = demo.repository.listGrantsForPerson(demo.person.id);
      return {
        claims: demo.repository.listClaimsForPerson(demo.person.id), grants,
        links: grants.flatMap((entry) => demo.repository.listGrantClaims(entry.id)),
        reviews: demo.repository.listReviewBundlesForPerson(demo.person.id)
          .flatMap((entry) => demo.repository.listReviewItemsForBundle(entry.id)),
        decisions: demo.repository.listReviewDecisionsForPerson(demo.person.id),
        audit: demo.repository.listAuditEventsForPerson(demo.person.id),
        handles: { document: demo.grants.document.id, contact: demo.grants.contact.id },
      };
    },
    close: demo.close,
  };
}
