#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openCoreDatabase, closeCoreDatabase } from '../../mio-core/src/db.js';
import { openConfiguredHost, seedFictionalDatabase, seedProfileDatabase, profileSchema } from './config.js';
import { reviewVersion } from './host.js';
import { getClaimTypeKeyForField } from '../../mio-core/src/claim-types.js';

// Local operator interface. These actions are intentionally absent from MCP.
// Possession of this CLI and OS file access is the trust boundary, not a proof
// that a human is present. Do not give an untrusted assistant shell/DB access.
function initialize(directory, seed, metadata) {
  if (!path.isAbsolute(directory)) throw new Error('Use an absolute new directory');
  fs.mkdirSync(directory, { mode: 0o700 }); // No recursive flag: never reuse/overwrite.
  const databasePath = path.join(directory, 'mio.sqlite');
  const fd = fs.openSync(databasePath, 'wx', 0o600); fs.closeSync(fd);
  const db = openCoreDatabase({ filePath: databasePath });
  try {
    const { config } = seed(db);
    const configPath = path.join(directory, 'config.json');
    fs.writeFileSync(configPath, `${JSON.stringify({ ...config, databasePath }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { configPath, databasePath, ...metadata };
  } finally { closeCoreDatabase(db); }
}
export function initializeDemo(directory) {
  return initialize(directory, seedFictionalDatabase, { fictional: true, grantExpiresInHours: 1 });
}
export function initializeProfile(directory, profile, confirmed = false) {
  if (!confirmed) throw new Error('Explicit operator confirmation of input facts and field sharing required');
  const validated = profileSchema.parse(profile); // Validate before creating any files.
  return initialize(directory, (db) => seedProfileDatabase(db, validated),
    { grantExpiresInHours: validated.expiresInHours, sharedFields: validated.allowedFields });
}
export function listReviews(state) {
  return state.repository.listPendingReviewItemsForPerson(state.config.personId)
    .filter((item) => item.metadata?.adapter === 'mio-mcp-v1' && item.metadata.requesterId === state.config.requesterId && item.metadata.grantId === state.config.grantId)
    .map((item) => ({ reviewItemId: item.id, field: item.metadata.claimTypeKey,
      currentValue: item.currentValue, suggestedValue: item.suggestedValue, rationale: item.rationale,
      expectedVersion: reviewVersion(item) }));
}
export function approveReview(state, { reviewItemId, expectedVersion, expectedValue, confirmed = false }) {
  if (!confirmed) throw new Error('Explicit local operator confirmation required');
  const { db, repository, config } = state;
  return repository.importWithinTransaction(() => {
    const item = repository.getReviewItem(reviewItemId);
    if (!item || item.personId !== config.personId || item.status !== 'pending' || item.target !== 'identity_claim' ||
        item.metadata?.adapter !== 'mio-mcp-v1' || item.metadata.requesterId !== config.requesterId ||
        item.metadata.grantId !== config.grantId || reviewVersion(item) !== expectedVersion ||
        !isDeepStrictEqual(item.suggestedValue, expectedValue) || typeof expectedValue !== 'string' ||
        getClaimTypeKeyForField(item.fieldKey) !== item.metadata.claimTypeKey) throw new Error('Pending review/version/value does not match');
    const current = repository.listClaimsForPerson(config.personId, { statuses: ['confirmed'] })
      .filter((claim) => claim.claimTypeKey === item.metadata.claimTypeKey && claim.supersededByClaimId === null);
    if (current.length !== 1 || !Number.isFinite(Date.parse(current[0].updatedAt)) || current[0].id !== item.metadata.expectedClaimId ||
        !isDeepStrictEqual(current[0].value, item.currentValue)) throw new Error('Confirmed data changed; review a new proposal');
    const timestamp = new Date().toISOString();
    const claim = repository.createClaim({ personId: config.personId, claimTypeKey: item.metadata.claimTypeKey,
      value: expectedValue, status: 'confirmed', issuer: 'local-operator', observedAt: timestamp, createdAt: timestamp });
    db.prepare('UPDATE claims SET superseded_by_claim_id = ? WHERE id = ? AND person_id = ?')
      .run(claim.id, current[0].id, config.personId);
    repository.createReviewDecision({ reviewItemId: item.id, bundleId: item.bundleId, personId: config.personId,
      decision: 'accepted', actorType: 'user', actorId: 'local-operator', appliedClaimId: claim.id, createdAt: timestamp });
    repository.resolveReviewItem({ reviewItemId: item.id, status: 'applied', resolvedAt: timestamp,
      resolvedByActorType: 'user', resolvedByActorId: 'local-operator', appliedClaimId: claim.id });
    repository.createAuditEvent({ personId: config.personId, actorType: 'user', actorId: 'local-operator',
      eventType: 'mcp.operator.approved', eventPayload: { reviewItemId: item.id, claimId: claim.id }, createdAt: timestamp });
    return { claimId: claim.id, field: claim.claimTypeKey, status: 'confirmed', shared: false };
  });
}
export function shareClaim(state, { field, claimId, confirmed = false }) {
  if (!confirmed) throw new Error('Explicit local operator sharing confirmation required');
  const { repository, config } = state;
  return repository.importWithinTransaction(() => {
    const now = Date.now();
    const grant = repository.listGrantsForPerson(config.personId).find((item) => item.id === config.grantId);
    const claims = repository.listClaimsForPerson(config.personId, { statuses: ['confirmed'] })
      .filter((item) => item.claimTypeKey === field && item.supersededByClaimId === null);
    const claim = claims[0];
    if (!grant || grant.requesterId !== config.requesterId || grant.status !== 'active' || grant.revokedAt !== null ||
        !Number.isFinite(Date.parse(grant.grantedAt)) || Date.parse(grant.grantedAt) > now ||
        (grant.expiresAt !== null && !(Date.parse(grant.expiresAt) > now)) ||
        !grant.actions.includes('read-granted-fields') || !grant.scope.allowedFields.includes(field) ||
        claims.length !== 1 || !Number.isFinite(Date.parse(claim.updatedAt)) || claim.id !== claimId ||
        (claim.expiresAt !== null && !(Date.parse(claim.expiresAt) > now))) throw new Error('Current claim and active allowed grant required');
    const existing = repository.listGrantClaims(grant.id).some((item) => item.claimId === claimId && item.accessMode === 'read');
    if (!existing) repository.attachGrantClaim({ grantId: grant.id, claimId, accessMode: 'read' });
    repository.createAuditEvent({ personId: config.personId, actorType: 'user', actorId: 'local-operator',
      eventType: 'mcp.operator.shared', eventPayload: { grantId: grant.id, field, claimId } });
    return { field, claimId, shared: true };
  });
}
export function revoke(state, confirmed = false) {
  if (!confirmed) throw new Error('Explicit local operator confirmation required');
  return state.repository.importWithinTransaction(() => {
    const grant = state.repository.listGrantsForPerson(state.config.personId).find((item) => item.id === state.config.grantId);
    if (!grant || grant.requesterId !== state.config.requesterId) throw new Error('Configured grant not found');
    state.repository.revokeGrant(grant.id);
    state.repository.createAuditEvent({ personId: state.config.personId, actorType: 'user', actorId: 'local-operator',
      eventType: 'mcp.operator.revoked', eventPayload: { grantId: grant.id } });
    return { status: 'revoked' };
  });
}
const USAGE = `Local operator commands (Node 24+):
  node adapters/mcp/admin.js init-demo /absolute/NEW-directory
  node adapters/mcp/admin.js init-profile /absolute/NEW-directory /absolute/profile.json --confirm
  node adapters/mcp/admin.js reviews /absolute/config.json
  node adapters/mcp/admin.js approve /absolute/config.json REVIEW_ID EXPECTED_VERSION EXPECTED_VALUE_JSON --confirm
  node adapters/mcp/admin.js share /absolute/config.json --field FIELD --claim-id CLAIM_ID --confirm
  node adapters/mcp/admin.js revoke /absolute/config.json --confirm
Approval records a confirmed value; separate share explicitly attaches its version.
The one-hour demo grant is not renewed by approval/sharing. This CLI is trusted local administration, not human authentication.`;
function main(args) {
  process.umask(0o077);
  const [command, target, ...rest] = args;
  if (command === '--help' || command === 'help') return console.log(USAGE);
  if (command === 'init-demo' && target && rest.length === 0) return console.log(JSON.stringify(initializeDemo(target), null, 2));
  if (command === 'init-profile' && target && rest.length === 2 && rest[1] === '--confirm') {
    if (!path.isAbsolute(rest[0])) throw new Error('Profile path must be absolute');
    return console.log(JSON.stringify(initializeProfile(target, JSON.parse(fs.readFileSync(rest[0], 'utf8')), true), null, 2));
  }
  if (!target || !['reviews', 'approve', 'share', 'revoke'].includes(command)) throw new Error(USAGE);
  const state = openConfiguredHost(target);
  try {
    let result;
    if (command === 'reviews' && rest.length === 0) result = listReviews(state);
    else if (command === 'approve' && rest.length === 4 && rest[3] === '--confirm') result = approveReview(state,
      { reviewItemId: rest[0], expectedVersion: rest[1], expectedValue: JSON.parse(rest[2]), confirmed: true });
    else if (command === 'share' && rest.length === 5 && rest[0] === '--field' && rest[2] === '--claim-id' && rest[4] === '--confirm') result = shareClaim(state,
      { field: rest[1], claimId: rest[3], confirmed: true });
    else if (command === 'share' && rest.length === 3 && rest[2] === '--confirm') result = shareClaim(state,
      { field: rest[0], claimId: rest[1], confirmed: true });
    else if (command === 'revoke' && rest.length === 1 && rest[0] === '--confirm') result = revoke(state, true);
    else throw new Error(USAGE);
    console.log(JSON.stringify(result, null, 2));
  } finally { state.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
