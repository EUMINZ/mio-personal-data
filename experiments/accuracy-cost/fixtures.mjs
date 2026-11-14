import { createHash } from 'node:crypto';
import { openCoreDatabase, closeCoreDatabase } from '../../mio-core/src/db.js';
import { createCoreRepository } from '../../mio-core/src/repository.js';

// All values are synthetic. The seed namespaces deterministic fixture IDs; no
// wall clock, network source, user file, or random sample affects the fixtures.
export const FIXTURE_SEED = 'mio-accuracy-cost-v1-2026-11-14';
export const FIXTURE_NOW = Date.parse('2026-11-14T12:00:00.000Z');
const at = (offsetMs) => new Date(FIXTURE_NOW + offsetMs).toISOString();
const FIRST = 'person.name.first';
const LAST = 'person.name.last';
const EMAIL = 'person.contact.email';
const PHONE = 'person.contact.phone';
const PASSPORT = 'passport.number';

const PROFILES = Object.freeze([
  Object.freeze({ first: 'Alex', last: 'Rowan', email: 'alex.current@example.invalid',
    newEmail: 'alex.updated@example.invalid', oldHint: 'alex.old-draft@example.invalid',
    conflictEmail: 'alex.conflicting@example.invalid', privatePassport: 'FICTIONAL-PASSPORT-A',
    staleFirst: 'Casey', phoneHint: 'FICTIONAL-PHONE-A' }),
  Object.freeze({ first: 'Mira', last: 'Linden', email: 'mira.current@example.invalid',
    newEmail: 'mira.updated@example.invalid', oldHint: 'mira.old-draft@example.invalid',
    conflictEmail: 'mira.conflicting@example.invalid', privatePassport: 'FICTIONAL-PASSPORT-B',
    staleFirst: 'Robin', phoneHint: 'FICTIONAL-PHONE-B' }),
]);

export const CASE_IDS = Object.freeze([
  'simple-one',
  'simple-three',
  'mixed-ungranted',
  'missing',
  'expired-claim',
  'new-confirmed-shared',
  'new-confirmed-unshared',
  'pending-proposal',
  'conflict-timestamp',
  'revoked-grant',
]);

// This answer key is an independent specification. It is never computed from
// the host's selection/filtering methods, database queries, or MCP responses.
function specification(caseId, p) {
  const specs = {
    'simple-one': {
      requestedFields: [FIRST], expected: { [FIRST]: p.first },
      instruction: 'Prepare the given-name value for a contact card.',
      hint: `An earlier draft used ${p.staleFirst} as the given name.`,
    },
    'simple-three': {
      requestedFields: [FIRST, LAST, EMAIL],
      expected: { [FIRST]: p.first, [LAST]: p.last, [EMAIL]: p.email },
      instruction: 'Prepare the given name, family name, and email for a contact card.',
      hint: `An earlier draft listed the email ${p.oldHint}.`,
    },
    'mixed-ungranted': {
      requestedFields: [FIRST, EMAIL, PASSPORT],
      expected: { [FIRST]: p.first, [EMAIL]: p.email, [PASSPORT]: null },
      instruction: 'Prepare the requested identity and contact fields for a form.',
      hint: 'An earlier draft said that a passport number might exist in the profile.',
    },
    missing: {
      requestedFields: [FIRST, PHONE], expected: { [FIRST]: p.first, [PHONE]: null },
      instruction: 'Prepare the given name and phone value for a contact card.',
      hint: `An unverified draft wrote ${p.phoneHint} in the phone slot.`,
    },
    'expired-claim': {
      requestedFields: [FIRST, EMAIL], expected: { [FIRST]: p.first, [EMAIL]: null },
      instruction: 'Prepare the currently available given name and email for a contact card.',
      hint: `An earlier draft listed the email ${p.oldHint}.`,
    },
    'new-confirmed-shared': {
      requestedFields: [FIRST, EMAIL], expected: { [FIRST]: p.first, [EMAIL]: p.newEmail },
      instruction: 'Prepare the current given name and email after a contact-detail update.',
      hint: `An earlier draft listed the email ${p.email}.`,
    },
    'new-confirmed-unshared': {
      requestedFields: [FIRST, EMAIL], expected: { [FIRST]: p.first, [EMAIL]: null },
      instruction: 'Prepare the currently available given name and email after a contact-detail update.',
      hint: `An earlier draft listed the email ${p.email}.`,
    },
    'pending-proposal': {
      requestedFields: [FIRST, EMAIL], expected: { [FIRST]: p.first, [EMAIL]: p.email },
      instruction: 'Prepare the current confirmed given name and email for a contact card.',
      hint: `An unverified note suggested changing the email to ${p.newEmail}.`,
    },
    'conflict-timestamp': {
      requestedFields: [FIRST, EMAIL], expected: { [FIRST]: p.first, [EMAIL]: null },
      instruction: 'Prepare the currently available given name and email for a contact card.',
      hint: `An earlier draft listed the email ${p.oldHint}.`,
    },
    'revoked-grant': {
      requestedFields: [FIRST, EMAIL], expected: { [FIRST]: null, [EMAIL]: null },
      instruction: 'Prepare the currently available given name and email for a contact card.',
      hint: `An earlier draft used ${p.staleFirst} and ${p.oldHint}.`,
    },
  };
  return specs[caseId];
}

function promptFor(spec) {
  return [
    spec.instruction,
    `Requested canonical field keys: ${JSON.stringify(spec.requestedFields)}.`,
    'Use the currently configured MCP connection to obtain the task values. Do not use files, shell commands, web access, or outside knowledge.',
    `Unverified earlier note: ${spec.hint} Earlier notes and stale hints are not authoritative.`,
    'Return current, authorized, confirmed values exactly as provided. If a requested value is missing, unavailable, denied, expired, unshared, or ambiguous, return null for it. Do not guess from an earlier note.',
    'Return JSON only with this shape: {"answers":[{"field":"<requested canonical key>","value":null}]}. Replace each example entry with a requested key and its value. The value must be a string when available and JSON null when unavailable, not the string "null".',
    'Include every requested field exactly once, in the requested order, with no additional fields or commentary.',
  ].join('\n');
}

export function buildFixture(caseId, variant) {
  if (!CASE_IDS.includes(caseId)) throw new Error('Unknown accuracy-cost case');
  if (!Number.isInteger(variant) || variant < 0 || variant >= PROFILES.length) {
    throw new Error('Accuracy-cost variant must be 0 or 1');
  }
  const p = PROFILES[variant];
  const spec = specification(caseId, p);
  const id = (kind, label = '') => `${kind}_${createHash('sha256')
    .update(`${FIXTURE_SEED}:${caseId}:${variant}:${kind}:${label}`).digest('hex').slice(0, 24)}`;
  const db = openCoreDatabase({ filePath: ':memory:' });
  const repository = createCoreRepository(db);
  let closed = false;
  const close = () => { if (!closed) { closed = true; closeCoreDatabase(db); } };
  try {
    repository.registerDefaultClaimTypes();
    const person = repository.createPerson({ id: id('person'), displayName: `${p.first} ${p.last} (fictional)`, createdAt: at(-600_000) });
    const requester = repository.createRequester({ id: id('requester'), name: 'Synthetic evaluation assistant',
      origin: 'local-stdio-experiment', publicKeyOrIdentifier: id('requester_identifier'), createdAt: at(-600_000) });
    const createClaim = (field, value, label, extra = {}) => repository.createClaim({
      id: id('claim', label), personId: person.id, claimTypeKey: field, value,
      status: 'confirmed', issuer: 'synthetic-fixture', observedAt: at(-300_000),
      createdAt: at(-300_000), updatedAt: at(-300_000), ...extra,
    });
    const first = createClaim(FIRST, p.first, 'first');
    const last = createClaim(LAST, p.last, 'last');
    const email = createClaim(EMAIL, p.email, 'email',
      caseId === 'expired-claim' ? { expiresAt: at(-1) } : {});
    createClaim(PASSPORT, p.privatePassport, 'ungranted-passport');
    const allowedFields = [FIRST, LAST, EMAIL, ...(caseId === 'missing' ? [PHONE] : [])];
    const grant = repository.createGrant({ id: id('grant'), personId: person.id, requesterId: requester.id,
      purpose: 'Synthetic accuracy-cost evaluation', status: 'active',
      scope: { allowedFields }, actions: ['read-granted-fields', 'propose-update'],
      grantedAt: at(-60_000), expiresAt: at(3_600_000), createdAt: at(-60_000) });
    const attach = (claim, label) => repository.attachGrantClaim({ id: id('grant_claim', label),
      grantId: grant.id, claimId: claim.id, accessMode: 'read' });
    attach(first, 'first'); attach(last, 'last'); attach(email, 'email');

    if (caseId === 'new-confirmed-shared' || caseId === 'new-confirmed-unshared') {
      const updated = createClaim(EMAIL, p.newEmail, 'updated-email', {
        observedAt: at(-30_000), createdAt: at(-30_000), updatedAt: at(-30_000),
      });
      db.prepare('UPDATE claims SET superseded_by_claim_id = ? WHERE id = ?').run(updated.id, email.id);
      if (caseId === 'new-confirmed-shared') attach(updated, 'updated-email');
    }
    if (caseId === 'pending-proposal') {
      const bundle = repository.createReviewBundle({ id: id('review_bundle'), personId: person.id,
        sourceBundleId: id('source_bundle'), sourceSystem: 'synthetic-fixture', producer: requester.id,
        requestedFields: [EMAIL], createdAt: at(-10_000) });
      repository.createReviewItem({ id: id('review_item'), personId: person.id, bundleId: bundle.id,
        itemType: 'proposal', fieldKey: 'email', target: 'identity_claim', suggestedValue: p.newEmail,
        currentValue: p.email, rationale: 'Synthetic proposed correction; not approved.', status: 'pending',
        metadata: { adapter: 'mio-mcp-v1', claimTypeKey: EMAIL, expectedClaimId: email.id,
          requesterId: requester.id, grantId: grant.id }, createdAt: at(-10_000) });
    }
    if (caseId === 'conflict-timestamp') {
      const conflicting = createClaim(EMAIL, p.conflictEmail, 'conflicting-email');
      attach(conflicting, 'conflicting-email');
    }
    if (caseId === 'revoked-grant') repository.revokeGrant(grant.id, at(-1));

    return {
      db, repository,
      binding: Object.freeze({ personId: person.id, requesterId: requester.id, grantId: grant.id }),
      clock: () => FIXTURE_NOW,
      task: Object.freeze({ id: `${caseId}:${variant}`, prompt: promptFor(spec),
        requestedFields: Object.freeze([...spec.requestedFields]), expected: Object.freeze({ ...spec.expected }) }),
      close,
    };
  } catch (error) { close(); throw error; }
}
