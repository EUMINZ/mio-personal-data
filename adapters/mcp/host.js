import { createHash } from 'node:crypto';
import { getFieldForClaimTypeKey } from '../../mio-core/src/claim-types.js';

export class AccessDenied extends Error {
  constructor() { super('Mio access denied'); }
}
const requireAccess = (condition) => { if (!condition) throw new AccessDenied(); };
const unexpired = (value, now) => value === null || (Number.isFinite(Date.parse(value)) && Date.parse(value) > now);

// Read-only claim selection shared with the local operator preview. This checks
// freshness and ambiguity, not permission; callers must enforce their own grant.
// No transaction or audit event is created by this helper.
export function selectLatestConfirmedClaim(repository, personId, field, now) {
  const claims = repository.listClaimsForPerson(personId, { statuses: ['confirmed'] })
    .filter((item) => item.claimTypeKey === field && item.supersededByClaimId === null);
  // ISO-8601 offsets can have different text ordering from actual instants.
  // Invalid timestamps anywhere in this candidate set make ordering unsafe.
  requireAccess(claims.every((claim) => Number.isFinite(Date.parse(claim.updatedAt)) && Date.parse(claim.updatedAt) <= now));
  claims.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const claim = claims[0];
  requireAccess(claim && claim.personId === personId && unexpired(claim.expiresAt, now));
  // A tied timestamp is ambiguous; the operator must resolve the data conflict.
  requireAccess(!claims[1] || Date.parse(claims[1].updatedAt) !== Date.parse(claim.updatedAt));
  return claim;
}

// This is a capability boundary for MCP calls, not OS process isolation. The local
// operator controls the database, config and this process. IDs are not credentials.
export function createScopedHost(repository, binding, { clock = Date.now } = {}) {
  const { personId, requesterId, grantId } = Object.freeze({ ...binding });
  function time() {
    const now = clock();
    requireAccess(Number.isFinite(now) && Number.isFinite(new Date(now).getTime()));
    return now;
  }
  function grantAt(now, action = 'read-granted-fields') {
    const grant = repository.listGrantsForPerson(personId).find((entry) => entry.id === grantId);
    requireAccess(grant && grant.personId === personId && grant.requesterId === requesterId);
    requireAccess(grant.status === 'active' && grant.revokedAt === null && unexpired(grant.expiresAt, now));
    requireAccess(Number.isFinite(Date.parse(grant.grantedAt)) && Date.parse(grant.grantedAt) <= now);
    requireAccess(Array.isArray(grant.actions) && grant.actions.includes(action));
    requireAccess(Array.isArray(grant.scope?.allowedFields));
    return grant;
  }
  function selected(grant, fields, now) {
    requireAccess(Array.isArray(fields) && fields.length > 0 && fields.length <= 50);
    const attached = repository.listGrantClaims(grant.id);
    return [...new Set(fields)].map((field) => {
      requireAccess(typeof field === 'string' && grant.scope.allowedFields.includes(field));
      const claim = selectLatestConfirmedClaim(repository, personId, field, now);
      requireAccess(attached.some((link) => link.claimId === claim.id && link.claimTypeKey === field && link.accessMode === 'read'));
      return claim;
    });
  }
  function audit(eventType, payload, now) {
    repository.createAuditEvent({ personId, actorType: 'requester', actorId: requesterId,
      eventType, eventPayload: { grantId, ...payload }, createdAt: new Date(now).toISOString() });
  }
  return {
    context(fields) {
      return repository.importWithinTransaction(() => {
        requireAccess(Array.isArray(fields) && fields.length > 0 && fields.length <= 50);
        requireAccess(fields.every((field) => typeof field === 'string' && field.length > 0 && field.length <= 120));
        const requested = [...new Set(fields)];
        const now = time(); const grant = grantAt(now);
        const available = []; const unavailable = [];
        for (const field of requested) {
          try {
            const [claim] = selected(grant, [field], now);
            available.push([field, claim.value]);
          } catch (error) {
            // Missing, unshared, expired, ambiguous and unauthorized facts have
            // the same public representation. Database failures must propagate.
            if (!(error instanceof AccessDenied)) throw error;
            unavailable.push(field);
          }
        }
        // A failed audit must abort the entire batch before any values escape.
        audit('mcp.context.read', { fields: available.map(([field]) => field), unavailable }, now);
        return { fields: Object.fromEntries(available), unavailable, checkedAt: new Date(now).toISOString() };
      });
    },
    listFields() {
      return repository.importWithinTransaction(() => {
        const now = time(); const grant = grantAt(now);
        const fields = [...new Set(grant.scope.allowedFields)].filter((field) => {
          try { selected(grant, [field], now); return true; }
          catch (error) { if (error instanceof AccessDenied) return false; throw error; }
        }).sort();
        audit('mcp.fields.listed', { fields }, now);
        return { fields };
      });
    },
    read(fields) {
      return repository.importWithinTransaction(() => {
        const now = time(); const claims = selected(grantAt(now), fields, now);
        audit('mcp.fields.read', { fields: claims.map((claim) => claim.claimTypeKey) }, now);
        return { fields: Object.fromEntries(claims.map((claim) => [claim.claimTypeKey, claim.value])) };
      });
    },
    propose({ field, value, rationale }) {
      return repository.importWithinTransaction(() => {
        const now = time(); const grant = grantAt(now, 'propose-update');
        // A proposal may only target an already readable, explicitly attached fact.
        grantAt(now, 'read-granted-fields');
        const [current] = selected(grant, [field], now);
        requireAccess(typeof value === 'string' && value.length > 0 && value.length <= 2048);
        requireAccess(typeof rationale === 'string' && rationale.length > 0 && rationale.length <= 1000);
        const fieldKey = getFieldForClaimTypeKey(field);
        requireAccess(fieldKey);
        const timestamp = new Date(now).toISOString();
        const bundle = repository.createReviewBundle({ personId, sourceSystem: 'mio-mcp',
          producer: requesterId, source: { grantId }, requestedFields: [field], createdAt: timestamp });
        const item = repository.createReviewItem({ personId, bundleId: bundle.id, itemType: 'proposal',
          fieldKey, target: 'identity_claim', suggestedValue: value, currentValue: current.value, rationale,
          metadata: { adapter: 'mio-mcp-v1', claimTypeKey: field, expectedClaimId: current.id, requesterId, grantId },
          createdAt: timestamp });
        audit('mcp.update.proposed', { reviewItemId: item.id, field }, now);
        return { reviewItemId: item.id, status: 'pending', message: 'Recorded for human review. The confirmed value is unchanged.' };
      });
    },
  };
}

export function reviewVersion(item) {
  return createHash('sha256').update(JSON.stringify({ id: item.id, personId: item.personId,
    fieldKey: item.fieldKey, target: item.target, status: item.status, suggestedValue: item.suggestedValue,
    currentValue: item.currentValue, metadata: item.metadata, rationale: item.rationale })).digest('hex');
}
