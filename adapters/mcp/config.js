import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PROFILE_CLAIM_TYPES } from '../../mio-core/src/claim-types.js';
import { z } from 'zod/v4';
import { openCoreDatabase, closeCoreDatabase } from '../../mio-core/src/db.js';
import { createCoreRepository } from '../../mio-core/src/repository.js';

const configSchema = z.strictObject({ schemaVersion: z.literal(1), databasePath: z.string().min(1),
  personId: z.string().min(1), requesterId: z.string().min(1), grantId: z.string().min(1) });

function privateFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular private file');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) {
    throw new Error('Config and database must be owned by this user with mode 0600');
  }
}
export function openConfiguredHost(configPath) {
  if (!path.isAbsolute(configPath)) throw new Error('Config path must be absolute');
  privateFile(configPath);
  const config = configSchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  if (!path.isAbsolute(config.databasePath)) throw new Error('Database path must be absolute');
  privateFile(config.databasePath);
  const db = openCoreDatabase({ filePath: config.databasePath, migrate: false });
  const repository = createCoreRepository(db);
  if (!repository.getPerson(config.personId)) { closeCoreDatabase(db); throw new Error('Configured person does not exist'); }
  return { db, repository, config, close: () => closeCoreDatabase(db) };
}

export function seedFictionalDatabase(db) {
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  const person = repository.createPerson({ displayName: 'Alex Rowan (fictional)' });
  const requester = repository.createRequester({ name: 'Local MCP assistant', origin: 'local-stdio', publicKeyOrIdentifier: 'fictional-mcp-assistant' });
  const now = Date.now();
  const claims = [
    ['person.name.first', 'Alex'], ['person.contact.email', 'alex.old@example.invalid'],
    ['passport.number', 'FICTIONAL_PRIVATE_DO_NOT_DISCLOSE'],
  ].map(([claimTypeKey, value]) => repository.createClaim({ personId: person.id, claimTypeKey, value,
    status: 'confirmed', issuer: 'fictional-local-user', createdAt: new Date(now - 60_000).toISOString() }));
  const allowed = claims.slice(0, 2);
  const grant = repository.createGrant({ personId: person.id, requesterId: requester.id,
    purpose: 'Fictional local MCP demonstration', status: 'active',
    scope: { allowedFields: allowed.map((claim) => claim.claimTypeKey) },
    actions: ['read-granted-fields', 'propose-update'], grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString() });
  for (const claim of allowed) repository.attachGrantClaim({ grantId: grant.id, claimId: claim.id, accessMode: 'read' });
  return { repository, config: { schemaVersion: 1, personId: person.id, requesterId: requester.id, grantId: grant.id } };
}
export function openDemoHost() {
  const db = openCoreDatabase({ filePath: ':memory:' });
  return { db, ...seedFictionalDatabase(db), close: () => closeCoreDatabase(db) };
}

const supportedFields = new Set(PROFILE_CLAIM_TYPES.map((entry) => entry[1]));
export const profileSchema = z.strictObject({
  displayName: z.string().min(1).max(100), requesterName: z.string().min(1).max(100),
  claims: z.record(z.string().refine((field) => supportedFields.has(field), 'Unsupported claim field'), z.string().min(1).max(2048))
    .refine((claims) => Object.keys(claims).length > 0 && Object.keys(claims).length <= 50, 'Expected 1 to 50 claims'),
  allowedFields: z.array(z.string()).min(1).max(50),
  expiresInHours: z.number().int().min(1).max(720), allowProposals: z.boolean(),
}).superRefine((profile, ctx) => {
  if (new Set(profile.allowedFields).size !== profile.allowedFields.length ||
      profile.allowedFields.some((field) => !Object.hasOwn(profile.claims, field))) {
    ctx.addIssue({ code: 'custom', message: 'allowedFields must be a unique explicit subset of claims', path: ['allowedFields'] });
  }
});
export function seedProfileDatabase(db, input) {
  const profile = profileSchema.parse(input);
  const repository = createCoreRepository(db);
  repository.registerDefaultClaimTypes();
  return repository.importWithinTransaction(() => {
    const timestamp = new Date().toISOString();
    const person = repository.createPerson({ displayName: profile.displayName, createdAt: timestamp });
    const requester = repository.createRequester({ name: profile.requesterName, origin: 'local-stdio',
      publicKeyOrIdentifier: `local-mcp-${randomUUID()}`, createdAt: timestamp });
    const claims = Object.fromEntries(Object.entries(profile.claims).map(([claimTypeKey, value]) => [claimTypeKey,
      repository.createClaim({ personId: person.id, claimTypeKey, value, status: 'confirmed',
        issuer: 'local-operator', observedAt: timestamp, createdAt: timestamp })]));
    const grant = repository.createGrant({ personId: person.id, requesterId: requester.id,
      purpose: 'Explicit locally configured assistant access', status: 'active',
      scope: { allowedFields: profile.allowedFields },
      actions: ['read-granted-fields', ...(profile.allowProposals ? ['propose-update'] : [])],
      grantedAt: timestamp, expiresAt: new Date(Date.parse(timestamp) + profile.expiresInHours * 3_600_000).toISOString(),
      createdAt: timestamp });
    for (const field of profile.allowedFields) repository.attachGrantClaim({ grantId: grant.id, claimId: claims[field].id, accessMode: 'read' });
    repository.createAuditEvent({ personId: person.id, actorType: 'user', actorId: 'local-operator',
      eventType: 'mcp.operator.initialized', eventPayload: { grantId: grant.id, fields: profile.allowedFields,
        allowProposals: profile.allowProposals }, createdAt: timestamp });
    return { repository, config: { schemaVersion: 1, personId: person.id, requesterId: requester.id, grantId: grant.id } };
  });
}
