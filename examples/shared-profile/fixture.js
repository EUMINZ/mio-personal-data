import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openCoreDatabase, closeCoreDatabase } from '../../mio-core/src/db.js';
import { createCoreRepository } from '../../mio-core/src/repository.js';
import { openConfiguredHost } from '../../adapters/mcp/config.js';

export const SHARED_PROFILE_FIELDS = Object.freeze({
  firstName: 'person.name.first', email: 'person.contact.email',
  address: 'person.contact.home_address', passport: 'passport.number',
});
export const SHARED_PROFILE_VALUES = Object.freeze({
  firstName: 'Alex', email: 'alex.old@example.invalid',
  nextEmail: 'alex.new@example.invalid', address: '12 Example Lane, Example City (fictional)',
  passport: 'FICTIONAL_PRIVATE_DO_NOT_DISCLOSE',
});
const F = SHARED_PROFILE_FIELDS;
const DEFINITIONS = Object.freeze({
  a: { label: 'Assistant A', fields: [F.firstName, F.email], actions: ['read-granted-fields', 'propose-update'] },
  b: { label: 'Assistant B', fields: [F.firstName, F.address], actions: ['read-granted-fields'] },
});
const SCHEMA = 'mio.shared-profile-demo.v1';

// This is a fictional local fixture, not an authentication mechanism. Each MCP
// process receives one config; the operator can access both and the underlying DB.
function directoryPath(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Use an absolute directory');
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error('Use a dedicated demo directory');
  // Resolve OS aliases such as /tmp before storing paths in the manifest. A
  // symlink at the demo directory itself is still rejected by lstat/mkdir.
  return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
}

function privateEntry(filePath, kind) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Expected a regular private ${kind}`);
  }
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) {
    throw new Error(`Demo ${kind} must be owned by this user and private`);
  }
}

function writePrivateJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

export function initializeSharedProfile(inputDirectory) {
  const directory = directoryPath(inputDirectory);
  // Refuse overwrite, including a symlink or an existing empty directory.
  fs.mkdirSync(directory, { mode: 0o700 });
  let db;
  try {
    const databasePath = path.join(directory, 'mio.sqlite');
    const fd = fs.openSync(databasePath, 'wx', 0o600);
    fs.closeSync(fd);
    db = openCoreDatabase({ filePath: databasePath });
    const repository = createCoreRepository(db);
    repository.registerDefaultClaimTypes();
    const manifest = repository.importWithinTransaction(() => {
      const createdAt = new Date().toISOString();
      const person = repository.createPerson({ displayName: 'Alex Rowan (fictional)', createdAt });
      const evidence = repository.createEvidence({ personId: person.id, kind: 'synthetic-profile',
        storageUri: 'urn:mio:fictional:shared-profile', mimeType: 'application/json',
        sourceSystem: 'shared-profile-demo', sourceName: 'Fictional profile fixture',
        metadata: { fictional: true }, createdAt });
      const claims = Object.fromEntries(Object.entries(F).map(([name, field]) => {
        const claim = repository.createClaim({ personId: person.id, claimTypeKey: field,
          value: SHARED_PROFILE_VALUES[name], status: 'confirmed', issuer: 'fictional-local-operator',
          observedAt: createdAt, createdAt });
        repository.linkClaimEvidence({ claimId: claim.id, evidenceId: evidence.id,
          relationType: 'extracted_from', note: 'Synthetic data for a local demonstration; not verified personal information.' });
        return [field, claim];
      }));
      const assistants = {};
      for (const [id, definition] of Object.entries(DEFINITIONS)) {
        const requester = repository.createRequester({ name: definition.label,
          origin: 'local-stdio', publicKeyOrIdentifier: `fictional-shared-profile-${id}`, createdAt });
        const grant = repository.createGrant({ personId: person.id, requesterId: requester.id,
          purpose: `${definition.label}: fictional shared-profile walkthrough`, status: 'active',
          scope: { allowedFields: definition.fields }, actions: definition.actions,
          grantedAt: createdAt, expiresAt: new Date(Date.parse(createdAt) + 24 * 3_600_000).toISOString(), createdAt });
        for (const field of definition.fields) {
          repository.attachGrantClaim({ grantId: grant.id, claimId: claims[field].id, accessMode: 'read' });
        }
        const configPath = path.join(directory, `assistant-${id}.json`);
        writePrivateJson(configPath, { schemaVersion: 1, databasePath,
          personId: person.id, requesterId: requester.id, grantId: grant.id });
        assistants[id] = { label: definition.label, configPath, fields: [...definition.fields] };
      }
      repository.createAuditEvent({ personId: person.id, actorType: 'user', actorId: 'local-operator',
        eventType: 'demo.shared-profile.initialized', eventPayload: { fictional: true, assistants: ['a', 'b'] }, createdAt });
      return { schemaVersion: SCHEMA, fictional: true, databasePath, personId: person.id, assistants };
    });
    const manifestPath = path.join(directory, 'manifest.json');
    writePrivateJson(manifestPath, manifest);
    closeCoreDatabase(db); db = undefined;
    return { directory, manifestPath, ...manifest };
  } catch (error) {
    if (db) closeCoreDatabase(db);
    // Only the directory created by this call is removed on initialization error.
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function openSharedProfile(inputDirectory) {
  const directory = directoryPath(inputDirectory);
  privateEntry(directory, 'directory');
  const manifestPath = path.join(directory, 'manifest.json');
  privateEntry(manifestPath, 'file');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const databasePath = path.join(directory, 'mio.sqlite');
  if (!manifest || manifest.schemaVersion !== SCHEMA || manifest.fictional !== true ||
      manifest.databasePath !== databasePath || typeof manifest.personId !== 'string' || !manifest.personId ||
      !manifest.assistants || !isDeepStrictEqual(Object.keys(manifest.assistants).sort(), ['a', 'b'])) {
    throw new Error('Invalid shared-profile demo manifest');
  }
  privateEntry(databasePath, 'file');
  // SQLite may follow symlinks for its sidecars, so check existing files before opening it.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${databasePath}${suffix}`;
    let present = false;
    try { fs.lstatSync(sidecar); present = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) privateEntry(sidecar, 'file');
  }
  const states = {};
  try {
    for (const [id, definition] of Object.entries(DEFINITIONS)) {
      const assistant = manifest.assistants[id];
      const configPath = path.join(directory, `assistant-${id}.json`);
      if (!assistant || assistant.configPath !== configPath || assistant.label !== definition.label ||
          !isDeepStrictEqual(assistant.fields, definition.fields)) throw new Error('Invalid assistant declaration');
      privateEntry(configPath, 'file');
      // Validate paths before openConfiguredHost can open a database selected by a modified config.
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.databasePath !== databasePath || config.personId !== manifest.personId) {
        throw new Error('Assistant must use the shared demo database and person');
      }
      const state = openConfiguredHost(configPath);
      states[id] = state;
      const grant = state.repository.listGrantsForPerson(manifest.personId).find((item) => item.id === state.config.grantId);
      if (!grant || grant.requesterId !== state.config.requesterId ||
          !isDeepStrictEqual(grant.scope?.allowedFields, definition.fields) || !isDeepStrictEqual(grant.actions, definition.actions)) {
        throw new Error('Assistant grant does not match the declared binding and fields');
      }
    }
    if (states.a.config.requesterId === states.b.config.requesterId || states.a.config.grantId === states.b.config.grantId) {
      throw new Error('Assistants require distinct requesters and grants');
    }
    let closed = false;
    return { manifest, states, close() {
      if (closed) return;
      closed = true;
      for (const state of Object.values(states)) state.close();
    } };
  } catch (error) {
    for (const state of Object.values(states)) state.close();
    throw error;
  }
}
