import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getFieldForClaimTypeKey } from '../../mio-core/src/claim-types.js';

export class AccessDenied extends Error {
  constructor() { super('Mio access denied'); }
}
const requireAccess = (condition) => { if (!condition) throw new AccessDenied(); };
const unexpired = (value, now) => value === null || (Number.isFinite(Date.parse(value)) && Date.parse(value) > now);

// This records what the requester says the source was. It does not fetch a URL,
// read a file, or establish that a document or its contents are authentic.
export function normalizeFactSource(source) {
  requireAccess(source && typeof source === 'object' && !Array.isArray(source));
  requireAccess(Object.keys(source).every((key) => ['kind', 'reference', 'locator'].includes(key)));
  requireAccess(['user-stated', 'document-extracted'].includes(source.kind));
  requireAccess(typeof source.reference === 'string' && source.reference.trim().length > 0 && source.reference.length <= 300);
  requireAccess(source.locator === undefined || (typeof source.locator === 'string' && source.locator.trim().length > 0 && source.locator.length <= 300));
  return { kind: source.kind, reference: source.reference.trim(),
    ...(source.locator === undefined ? {} : { locator: source.locator.trim() }) };
}

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

// These helpers do not create a transaction or audit event. Trusted callers must
// wrap selection and use in one transaction and record the operation before return.
export function getActiveGrant(repository, binding, now, action = 'read-granted-fields') {
  requireAccess(Number.isFinite(now) && Number.isFinite(new Date(now).getTime()));
  const { personId, requesterId, grantId } = binding;
  const grant = repository.listGrantsForPerson(personId).find((entry) => entry.id === grantId);
  requireAccess(grant && grant.personId === personId && grant.requesterId === requesterId);
  requireAccess(grant.status === 'active' && grant.revokedAt === null && unexpired(grant.expiresAt, now));
  requireAccess(Number.isFinite(Date.parse(grant.grantedAt)) && Date.parse(grant.grantedAt) <= now);
  requireAccess(Array.isArray(grant.actions) && grant.actions.includes(action));
  requireAccess(Array.isArray(grant.scope?.allowedFields));
  return grant;
}

export function selectGrantedClaim(repository, grant, field, now) {
  requireAccess(typeof field === 'string' && Array.isArray(grant.scope?.allowedFields) && grant.scope.allowedFields.includes(field));
  const claim = selectLatestConfirmedClaim(repository, grant.personId, field, now);
  requireAccess(repository.listGrantClaims(grant.id).some((link) =>
    link.claimId === claim.id && link.claimTypeKey === field && link.accessMode === 'read'));
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
    return getActiveGrant(repository, { personId, requesterId, grantId }, now, action);
  }
  function selected(grant, fields, now) {
    requireAccess(Array.isArray(fields) && fields.length > 0 && fields.length <= 50);
    return [...new Set(fields)].map((field) => selectGrantedClaim(repository, grant, field, now));
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
    proposeFact({ field, value, rationale, source }) {
      return repository.importWithinTransaction(() => {
        const now = time(); const grant = grantAt(now, 'propose-new-fact');
        requireAccess(typeof field === 'string' && grant.scope.allowedFields.includes(field)
          && Array.isArray(grant.scope.collectFields) && grant.scope.collectFields.includes(field));
        const fieldKey = getFieldForClaimTypeKey(field);
        requireAccess(fieldKey && repository.getClaimTypeByKey(field));
        requireAccess(typeof value === 'string' && value.trim().length > 0 && value.length <= 2048);
        requireAccess(typeof rationale === 'string' && rationale.trim().length > 0 && rationale.length <= 1000);
        const provenance = normalizeFactSource(source);
        const candidates = repository.listClaimsForPerson(personId, { statuses: ['confirmed'] })
          .filter((claim) => claim.claimTypeKey === field && claim.supersededByClaimId === null);
        // Existing, expired, ambiguous and unshared facts all deny this path.
        // New-fact collection cannot overwrite or disclose a prior fact.
        requireAccess(candidates.length === 0);
        const cleanedValue = value.trim(); const cleanedRationale = rationale.trim();
        const duplicate = repository.listPendingReviewItemsForPerson(personId).find((item) =>
          item.itemType === 'proposal' && item.target === 'identity_claim' && item.fieldKey === fieldKey
          && item.metadata?.adapter === 'mio-mcp-v1' && item.metadata.proposalKind === 'new-fact'
          && item.metadata.requesterId === requesterId && item.metadata.grantId === grantId
          && item.metadata.claimTypeKey === field && item.metadata.expectedClaimId === null && item.currentValue === null
          && item.suggestedValue === cleanedValue && item.rationale === cleanedRationale
          && isDeepStrictEqual(item.metadata.source, provenance));
        if (duplicate) return { reviewItemId: duplicate.id, status: 'pending',
          message: 'This exact proposal is already waiting for human review. No confirmed fact or sharing permission changed.' };
        const timestamp = new Date(now).toISOString();
        const bundle = repository.createReviewBundle({ personId, sourceSystem: 'mio-mcp',
          producer: requesterId, source: { grantId, ...provenance }, requestedFields: [field], createdAt: timestamp });
        const item = repository.createReviewItem({ personId, bundleId: bundle.id, itemType: 'proposal',
          fieldKey, target: 'identity_claim', suggestedValue: cleanedValue, currentValue: null, rationale: cleanedRationale,
          metadata: { adapter: 'mio-mcp-v1', proposalKind: 'new-fact', claimTypeKey: field,
            expectedClaimId: null, requesterId, grantId, source: provenance }, createdAt: timestamp });
        audit('mcp.fact.proposed', { reviewItemId: item.id, field }, now);
        return { reviewItemId: item.id, status: 'pending', message: 'New fact recorded for human review. Nothing has been confirmed or shared.' };
      });
    },
  };
}

export function reviewVersion(item) {
  return createHash('sha256').update(JSON.stringify({ id: item.id, personId: item.personId,
    fieldKey: item.fieldKey, target: item.target, status: item.status, suggestedValue: item.suggestedValue,
    currentValue: item.currentValue, metadata: item.metadata, rationale: item.rationale })).digest('hex');
}
