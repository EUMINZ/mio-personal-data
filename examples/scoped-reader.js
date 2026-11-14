// Teaching adapter for a trusted local host. This is NOT an authentication API.
// The host must bind personId/requesterId/grantId itself; never accept them as
// proof of identity from an untrusted assistant. Direct repository access bypasses
// this example's checks. No full dossier, evidence, memory, or review queue is sent.
export class DemoAccessDenied extends Error {
  constructor() {
    super('Demo access denied');
    this.name = 'DemoAccessDenied';
  }
}

function requireAccess(condition) {
  if (!condition) throw new DemoAccessDenied();
}

function unexpired(timestamp, now) {
  return timestamp === null || (Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) > now);
}

export function readScopedClaims(repository, {
  personId, requesterId, grantId, requestedFields, now = Date.now(),
}) {
  requireAccess(Number.isFinite(now));
  requireAccess(typeof personId === 'string' && typeof requesterId === 'string');
  requireAccess(repository.getPerson(personId));
  requireAccess(Array.isArray(requestedFields) && requestedFields.length > 0);
  requireAccess(requestedFields.every((field) => typeof field === 'string'));

  // Select by the authenticated host's person before considering the grant ID.
  const grant = repository.listGrantsForPerson(personId).find((entry) => entry.id === grantId);
  requireAccess(grant && grant.personId === personId && grant.requesterId === requesterId);
  requireAccess(grant.status === 'active' && grant.revokedAt === null);
  requireAccess(unexpired(grant.expiresAt, now));
  requireAccess(Number.isFinite(Date.parse(grant.grantedAt)) && Date.parse(grant.grantedAt) <= now);
  requireAccess(Array.isArray(grant.actions) && grant.actions.includes('read-granted-fields'));
  requireAccess(Array.isArray(grant.scope?.allowedFields));

  const allowed = new Set(grant.scope.allowedFields);
  const attached = repository.listGrantClaims(grant.id);
  const claims = repository.listClaimsForPerson(personId);
  const selected = [];
  for (const field of new Set(requestedFields)) {
    requireAccess(allowed.has(field));
    // Only confirmed canonical facts qualify in this intentionally strict demo.
    // A newer fact needs a new explicit attachment; old grants do not follow it.
    const latest = repository.getLatestClaimForType(personId, field, ['confirmed']);
    requireAccess(latest && latest.personId === personId && latest.status === 'confirmed');
    requireAccess(unexpired(latest.expiresAt, now) && latest.supersededByClaimId === null);
    const link = attached.find((entry) => entry.claimId === latest.id && entry.accessMode === 'read');
    requireAccess(link && link.claimTypeKey === field);
    requireAccess(claims.some((claim) => claim.id === link.claimId && claim.personId === personId));
    selected.push(latest);
  }

  repository.createAuditEvent({
    personId,
    actorType: 'requester',
    actorId: requesterId,
    eventType: 'demo.fields.read',
    eventPayload: { grantId, fields: selected.map((claim) => claim.claimTypeKey) },
    createdAt: new Date(now).toISOString(),
  });
  // Deliberately omit internal IDs, source documents, confidence, and other data.
  return { fields: Object.fromEntries(selected.map((claim) => [claim.claimTypeKey, claim.value])) };
}
