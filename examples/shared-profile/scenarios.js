import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { AccessDenied, getActiveGrant, selectGrantedClaim } from '../../adapters/mcp/host.js';
import { SHARED_PROFILE_FIELDS as F } from './fixture.js';

const text = z.string().trim().min(1).max(300);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date');
const identity = (inputKey, label, claimTypeKey) => ({ inputKey, label, claimTypeKey, kind: 'identity' });
const task = (key, label, type, placeholder) => ({ key, label, type, placeholder, required: true });

// These are versioned demo mappings, not claims of support for official sites.
// A task's destination/date/department never becomes a canonical identity fact.
export const SCENARIOS = Object.freeze([
  { id: 'travel', assistantId: 'a', label: 'Travel application', recipient: 'Example Travel Desk',
    description: 'Prepare a fictional travel request using reviewed personal information.',
    fields: [identity('givenName', 'Given name', F.firstName), identity('contactEmail', 'Contact email', F.email),
      identity('employerName', 'Employer', F.employer), identity('occupation', 'Job title', F.jobTitle)],
    taskFields: [task('destination', 'Destination', 'text', 'Example City'), task('purpose', 'Purpose of travel', 'text', 'Fictional research visit')],
    taskSchema: z.strictObject({ destination: text, purpose: text }) },
  { id: 'onboarding', assistantId: 'b', label: 'Employee onboarding', recipient: 'Example People Team',
    description: 'Reuse the same confirmed identity facts in a separate fictional registration.',
    fields: [identity('firstName', 'First name', F.firstName), identity('residentialAddress', 'Home address', F.address),
      identity('organization', 'Employer', F.employer), identity('position', 'Job title', F.jobTitle)],
    taskFields: [task('startDate', 'Start date', 'date', 'YYYY-MM-DD'), task('department', 'Department', 'text', 'Example Research')],
    taskSchema: z.strictObject({ startDate: date, department: text }) },
]);

export function claimSource(repository, claim) {
  const linked = new Set(repository.listClaimEvidenceLinks(claim.id).map((link) => link.evidenceId));
  const evidence = repository.listEvidenceForPerson(claim.personId).find((entry) => linked.has(entry.id));
  const reported = evidence?.kind === 'reported-source' ? evidence.metadata : null;
  return { claimId: claim.id, confirmedAt: claim.createdAt,
    kind: reported?.kind ?? (evidence?.kind === 'synthetic-profile' ? 'fictional-fixture' : 'operator-confirmed'),
    reference: reported?.reference ?? (evidence?.kind === 'synthetic-profile' ? 'Fictional profile fixture' : 'Local operator decision'),
    ...(reported?.locator ? { locator: reported.locator } : {}), verified: false };
}

function grantForScenario(state, scenario, now) {
  const grant = getActiveGrant(state.repository, state.config, now, 'prepare-form-draft');
  getActiveGrant(state.repository, state.config, now, 'read-granted-fields');
  if (!Array.isArray(grant.scope.scenarioIds) || !grant.scope.scenarioIds.includes(scenario.id)) throw new AccessDenied();
  return grant;
}

// Called inside the operator snapshot's read transaction. It does not perform an
// assistant read or write an audit event simply because the page is polling.
export function scenarioSnapshot(demo, now = Date.now()) {
  if (demo.manifest.schemaVersion !== 'mio.shared-profile-demo.v2') return [];
  return SCENARIOS.map(({ taskSchema, ...scenario }) => {
    // All operator projections use the connection holding the caller's read
    // transaction, including B's binding, for one consistent SQLite snapshot.
    const state = { ...demo.states[scenario.assistantId], repository: demo.states.a.repository };
    let grant;
    try { grant = grantForScenario(state, scenario, now); }
    catch (error) { if (!(error instanceof AccessDenied)) throw error; }
    const existing = state.repository.listClaimsForPerson(state.config.personId, { statuses: ['confirmed'] });
    return { ...scenario, active: Boolean(grant), fields: scenario.fields.map((field) => {
      let claim;
      if (grant) {
        try { claim = selectGrantedClaim(state.repository, grant, field.claimTypeKey, now); }
        catch (error) { if (!(error instanceof AccessDenied)) throw error; }
      }
      const collectible = Boolean(grant?.actions.includes('propose-new-fact')
        && grant.scope.allowedFields.includes(field.claimTypeKey) && grant.scope.collectFields?.includes(field.claimTypeKey)
        && !existing.some((entry) => entry.claimTypeKey === field.claimTypeKey && entry.supersededByClaimId === null));
      return { ...field, state: claim ? 'shared' : 'unavailable', collectible,
        ...(claim ? { value: claim.value, source: claimSource(state.repository, claim) } : {}) };
    }) };
  });
}

export function listFormDrafts(demo) {
  if (demo.manifest.schemaVersion !== 'mio.shared-profile-demo.v2') return [];
  return demo.states.a.db.prepare(`SELECT payload_json FROM demo_form_drafts WHERE person_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 10`).all(demo.manifest.personId).map((row) => JSON.parse(row.payload_json));
}

export function prepareFormDraft(demo, { assistantId, scenarioId, taskValues }) {
  const scenario = SCENARIOS.find((entry) => entry.id === scenarioId && entry.assistantId === assistantId);
  if (demo.manifest.schemaVersion !== 'mio.shared-profile-demo.v2' || !scenario) throw new AccessDenied();
  const parsed = scenario.taskSchema.safeParse(taskValues);
  if (!parsed.success) throw Object.assign(new Error('Complete the task fields using the expected format; identity overrides are not accepted.'), { status: 400 });
  const state = demo.states[assistantId];
  return state.repository.importWithinTransaction(() => {
    const now = Date.now();
    const grant = grantForScenario(state, scenario, now);
    const fields = []; const missing = [];
    for (const field of scenario.fields) {
      let claim;
      try { claim = selectGrantedClaim(state.repository, grant, field.claimTypeKey, now); }
      catch (error) { if (!(error instanceof AccessDenied)) throw error; }
      if (!claim) { missing.push({ inputKey: field.inputKey, label: field.label }); continue; }
      fields.push({ inputKey: field.inputKey, label: field.label, value: claim.value, origin: 'identity',
        claimId: claim.id, source: claimSource(state.repository, claim) });
    }
    for (const field of scenario.taskFields) {
      fields.push({ inputKey: field.key, label: field.label, value: parsed.data[field.key], origin: 'task' });
    }
    const draft = { id: `draft_${randomUUID()}`, scenarioId: scenario.id, label: scenario.label,
      recipient: scenario.recipient, createdAt: new Date(now).toISOString(),
      fields, missing, status: 'draft', submitted: false };
    state.db.prepare(`INSERT INTO demo_form_drafts (id,person_id,requester_id,scenario_id,payload_json,created_at)
      VALUES (?,?,?,?,?,?)`).run(draft.id, state.config.personId, state.config.requesterId, scenario.id, JSON.stringify(draft), draft.createdAt);
    state.repository.createAuditEvent({ personId: state.config.personId, actorType: 'requester', actorId: state.config.requesterId,
      eventType: 'demo.form.drafted', eventPayload: { grantId: grant.id, draftId: draft.id, scenarioId: scenario.id,
        claimIds: fields.filter((field) => field.origin === 'identity').map((field) => field.claimId),
        missing: missing.map((field) => field.inputKey) }, createdAt: draft.createdAt });
    return draft;
  });
}
