// A deliberately competent JSON alternative, not a deliberately broken baseline.
// Implements the same benchmark policies in memory without Mio imports.
// Like the Mio example, this is a trusted local host, not an authentication API.
export class JsonAccessDenied extends Error {}
const allow = (condition) => { if (!condition) throw new JsonAccessDenied('Access denied'); };

export function createJsonHost(fixture, profileSize) {
  let now = Date.parse(fixture.now);
  let state = {
    personId: 'fictional-person', claims: [], grants: [], review: null, decisions: [], audit: [],
    handles: { document: 'grant-document', contact: 'grant-contact' },
  };
  const personId = state.personId;
  const ownerActorId = 'fictional-local-user';
  const email = 'person.contact.email';
  let sequence = 0;
  const nextId = () => `json-${++sequence}`;
  const latest = (field) => state.claims.filter((claim) => claim.personId === personId &&
    claim.field === field && claim.status === 'confirmed').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const transaction = (operation) => {
    const before = structuredClone(state);
    try { return operation(); } catch (error) { state = before; throw error; }
  };
  const audit = (event, fail = false) => {
    if (fail) throw new Error('Injected audit failure');
    state.audit.push({ event, at: now });
  };
  for (const [field, value] of Object.entries(fixture.fields).slice(0, profileSize)) {
    state.claims.push({ id: nextId(), personId, field, value, status: 'confirmed',
      updatedAt: now - 60_000, expiresAt: null, superseded: false, issuer: 'fixture' });
  }
  function grant(assistant, fields) {
    const value = { id: nextId(), personId, requesterId: `requester-${assistant}`,
      fields, claims: fields.map((field) => ({ claimId: latest(field).id, mode: 'read' })),
      actions: ['read-granted-fields'], grantedAt: now, expiresAt: now + 3_600_000,
      status: 'active', revokedAt: null };
    state.grants.push(value);
    return value;
  }
  for (const [assistant, fields] of [
    ['document', ['person.name.first', 'person.name.last']],
    ['contact', ['person.name.first', email]],
  ]) {
    state.handles[assistant] = grant(assistant, fields).id;
    audit('grant.created');
  }
  function read(task, overrides = {}) {
    const request = { personId, requesterId: `requester-${task.assistant}`,
      grantId: state.handles[task.assistant], requestedFields: task.requestedFields, ...overrides };
    allow(Number.isFinite(now));
    allow(request.personId === personId);
    allow(Array.isArray(request.requestedFields) && request.requestedFields.length > 0 &&
      request.requestedFields.every((field) => typeof field === 'string'));
    const currentGrant = state.grants.find((entry) => entry.id === request.grantId);
    allow(currentGrant && currentGrant.personId === request.personId &&
      currentGrant.requesterId === request.requesterId);
    allow(currentGrant.status === 'active' && currentGrant.revokedAt === null &&
      currentGrant.grantedAt <= now && currentGrant.expiresAt > now &&
      currentGrant.actions.includes('read-granted-fields'));
    const fields = {};
    for (const field of new Set(request.requestedFields)) {
      allow(currentGrant.fields.includes(field));
      const claim = latest(field);
      allow(claim && !claim.superseded && (claim.expiresAt === null || claim.expiresAt > now));
      allow(currentGrant.claims.some((link) => link.claimId === claim.id && link.mode === 'read'));
      fields[field] = claim.value;
    }
    audit('fields.read');
    return { fields };
  }
  function propose() {
    read({ assistant: 'contact', requestedFields: [email] });
    state.review = { id: nextId(), status: 'pending', currentValue: latest(email).value,
      suggestedValue: fixture.newEmail, personId };
    return 'pending';
  }
  function confirm({ failAudit = false } = {}) {
    const review = state.review;
    if (!review || review.status !== 'pending' || review.personId !== personId ||
        review.currentValue !== latest(email).value) throw new Error('Invalid review or conflict');
    return transaction(() => {
      const claim = { id: nextId(), personId, field: email, value: review.suggestedValue,
        status: 'confirmed', updatedAt: now, expiresAt: null, superseded: false, issuer: ownerActorId };
      state.claims.push(claim);
      state.decisions.push({ reviewId: review.id, claimId: claim.id, actorId: ownerActorId });
      state.review = { ...review, status: 'applied', claimId: claim.id };
      audit('claim.confirmed', failAudit);
      return claim;
    });
  }
  function authorize({ failAudit = false } = {}) {
    if (latest(email)?.issuer !== ownerActorId) throw new Error('Expected confirmed update');
    const nextGrant = transaction(() => {
      const previous = state.grants.find((entry) => entry.id === state.handles.contact);
      previous.status = 'revoked';
      previous.revokedAt = now;
      const created = grant('contact', ['person.name.first', email]);
      audit('grant.created', failAudit);
      return created;
    });
    state.handles.contact = nextGrant.id;
  }
  return {
    read, propose, confirm, authorize,
    setNow(value) { now = value; },
    revoke() {
      const current = state.grants.find((entry) => entry.id === state.handles.contact);
      current.status = 'revoked'; current.revokedAt = now;
    },
    state() { return structuredClone(state); },
    close() {},
  };
}
